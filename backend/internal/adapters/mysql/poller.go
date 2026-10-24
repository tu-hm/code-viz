package mysql

import (
	"context"
	"database/sql"
	"log/slog"
	"sync"
	"time"

	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/sqlc"
)

const (
	pollEvery = 250 * time.Millisecond
	pollLimit = 500
	overlap   = time.Second // rows committed late; worker clocks behind ours
	maxParked = 5000        // per pod (§0.2 S5)
)

// Poller is the Events port: a change poller on traces.updated_at that runs only while requests are parked (§7.13.3).
type Poller struct {
	db    *sql.DB
	now   func() time.Time
	after func(time.Duration) <-chan time.Time

	mu      sync.Mutex
	waiters map[*waiter]struct{}
	stopped bool
	active  chan struct{}
}

type waiter struct {
	traceID string
	since   int64
	woken   chan struct{}
}

func NewPoller(db *sql.DB, now func() time.Time, after func(time.Duration) <-chan time.Time) *Poller {
	return &Poller{
		db:      db,
		now:     now,
		after:   after,
		waiters: map[*waiter]struct{}{},
		active:  make(chan struct{}, 1),
	}
}

func (p *Poller) Wait(ctx context.Context, traceID string, since int64) error {
	w := &waiter{traceID: traceID, since: since, woken: make(chan struct{})}
	p.mu.Lock()
	if p.stopped {
		p.mu.Unlock()
		return nil
	}
	if len(p.waiters) >= maxParked {
		p.mu.Unlock()
		return domain.ErrCapacity
	}
	p.waiters[w] = struct{}{}
	if len(p.waiters) == 1 {
		select {
		case p.active <- struct{}{}:
		default:
		}
	}
	p.mu.Unlock()

	select {
	case <-w.woken:
		return nil
	case <-ctx.Done():
		p.mu.Lock()
		delete(p.waiters, w)
		p.mu.Unlock()
		return ctx.Err()
	}
}

// Run polls every 250 ms while requests are parked, and blocks without querying while none are. It returns when ctx is done,
// and then wakes every parked request and parks no more, so long-polls end with their current state on shutdown (§13).
func (p *Poller) Run(ctx context.Context) {
	defer p.stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-p.active:
		}
		p.pollWhileParked(ctx)
	}
}

func (p *Poller) pollWhileParked(ctx context.Context) {
	from := p.now().Add(-overlap) // callers read their row right before Wait; older changes are in that read
	for {
		select {
		case <-ctx.Done():
			return
		case <-p.after(pollEvery):
		}
		if p.idle() {
			return
		}
		rows, err := sqlc.New(p.db).ChangedTraces(ctx, sqlc.ChangedTracesParams{Since: from, Limit: pollLimit})
		if err != nil {
			if ctx.Err() == nil {
				slog.ErrorContext(ctx, "poll changed traces", "err", err)
			}
			continue
		}
		p.wake(rows)
		from = advance(from, rows)
	}
}

func (p *Poller) stop() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.stopped = true
	for w := range p.waiters {
		delete(p.waiters, w)
		close(w.woken)
	}
}

func (p *Poller) idle() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.waiters) == 0
}

func (p *Poller) wake(rows []sqlc.ChangedTracesRow) {
	versions := make(map[string]int64, len(rows))
	for _, r := range rows {
		versions[r.ID] = r.Version
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	for w := range p.waiters {
		if v, ok := versions[w.traceID]; ok && v > w.since {
			delete(p.waiters, w)
			close(w.woken)
		}
	}
}

func advance(from time.Time, rows []sqlc.ChangedTracesRow) time.Time {
	if len(rows) == 0 {
		return from
	}
	last := rows[len(rows)-1].UpdatedAt
	if len(rows) < pollLimit {
		return later(from, last.Add(-overlap))
	}
	// full batch => no overlap and ≥1 µs on, or the same rows come back forever; >500 rows in one µs => rest wait out their timeout
	return later(last, from.Add(time.Microsecond))
}

func later(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}
