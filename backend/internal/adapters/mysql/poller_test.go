package mysql_test

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/google/go-cmp/cmp"

	"github.com/tu-hm/code-viz/backend/internal/adapters/mysql"
	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/sqlc"
	"github.com/tu-hm/code-viz/backend/internal/ports"
)

var _ ports.Events = (*mysql.Poller)(nil)

func TestWaitReturnsOnlyWhenAPollSeesItsTraceAboveSince(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		since  int64
		bumped string
		at     time.Time
		want   error
	}{
		{"own trace bumped above since after parking", 0, "trc_x", t0.Add(time.Millisecond), nil},
		{"own trace bumped above since half a second before parking", 0, "trc_x", t0.Add(-500 * time.Millisecond), nil},
		{"own trace bumped only to since", 1, "trc_x", t0.Add(time.Millisecond), context.Canceled},
		{"another trace bumped above since", 0, "trc_y", t0.Add(time.Millisecond), context.Canceled},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			db := migratedDB(t)
			addTrace(t, db, "trc_x", t0.Add(-time.Hour))
			addTrace(t, db, "trc_y", t0.Add(-time.Hour))
			p, ticks := startPoller(t, db)

			w := parkOnX(t, p, tt.since)
			bump(t, db, tt.bumped, tt.at)
			ticks.fire(t)
			ticks.next(t)
			w.cancel()

			if err := receive(t, w.err); !errors.Is(err, tt.want) {
				t.Errorf("err = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestPollerRunsEvery250msOnlyWhileARequestIsParked(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		c := &refusingConnector{}
		db := sql.OpenDB(c)
		defer closeDB(t, db)
		var timers atomic.Int64
		after := func(d time.Duration) <-chan time.Time {
			timers.Add(1)
			return time.After(d)
		}
		p := mysql.NewPoller(db, time.Now, after)
		ctx, cancel := context.WithCancel(t.Context())
		stopped := make(chan struct{})
		go func() {
			defer close(stopped)
			p.Run(ctx)
		}()
		defer func() {
			cancel()
			<-stopped
		}()

		type total struct{ Timers, Queries int64 }
		var got []total
		<-time.After(time.Minute)
		got = append(got, total{timers.Load(), c.attempts.Load()})

		w := parkOnX(t, p, 0)
		<-time.After(time.Second + time.Millisecond)
		got = append(got, total{timers.Load(), c.attempts.Load()})
		w.cancel()
		if err := receive(t, w.err); !errors.Is(err, context.Canceled) {
			t.Fatalf("err = %v, want context.Canceled", err)
		}

		<-time.After(time.Minute)
		got = append(got, total{timers.Load(), c.attempts.Load()})
		want := []total{{0, 0}, {5, 4}, {5, 4}}
		if diff := cmp.Diff(want, got); diff != "" {
			t.Errorf("timers and queries after an idle minute, a parked second, an idle minute (-want +got):\n%s", diff)
		}
	})
}

func TestWaitRefusesThe5001stRequestAndFreesSlotsWhenCtxEnds(t *testing.T) {
	t.Parallel()
	p := mysql.NewPoller(nil, nil, nil)
	ctx, cancel := context.WithCancel(t.Context())
	errs := make(chan error, 5001)
	for range 5001 {
		go func() { errs <- p.Wait(ctx, "trc_x", 0) }()
	}

	if err := receive(t, errs); !errors.Is(err, domain.ErrCapacity) {
		t.Fatalf("first return: err = %v, want ErrCapacity", err)
	}
	cancel()
	for i := range 5000 {
		if err := receive(t, errs); !errors.Is(err, context.Canceled) {
			t.Fatalf("return %d after cancel: err = %v, want context.Canceled", i+1, err)
		}
	}
	gone, leave := context.WithCancel(t.Context())
	leave()
	if err := p.Wait(gone, "trc_x", 0); !errors.Is(err, context.Canceled) {
		t.Errorf("wait once every request left: err = %v, want context.Canceled", err)
	}
}

func TestStoppedPollerWakesParkedRequestsAndParksNoMore(t *testing.T) {
	t.Parallel()
	asked := make(chan struct{}, 1)
	p := mysql.NewPoller(nil, func() time.Time { return t0 }, func(time.Duration) <-chan time.Time {
		asked <- struct{}{}
		return nil
	})
	ctx, cancel := context.WithCancel(t.Context())
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		p.Run(ctx)
	}()

	parked := parkOnX(t, p, 0)
	select {
	case <-asked:
	case <-time.After(time.Minute):
		t.Fatal("poller did not start polling for the parked request within a minute")
	}
	cancel()
	<-stopped

	if err := receive(t, parked.err); err != nil {
		t.Errorf("request parked before the stop: err = %v, want nil", err)
	}
	late := parkOnX(t, p, 0)
	if err := receive(t, late.err); err != nil {
		t.Errorf("request after the stop: err = %v, want nil", err)
	}
}

func TestPollerKeepsRequestsParkedThroughAFailedQuery(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	db := migratedDB(t)
	addTrace(t, db, "trc_x", t0.Add(-time.Hour))
	p, ticks := startPoller(t, db)
	w := parkOnX(t, p, 0)

	if _, err := db.ExecContext(ctx, "RENAME TABLE traces TO traces_away"); err != nil {
		t.Fatal(err)
	}
	ticks.fire(t)
	tick := ticks.next(t)
	if _, err := db.ExecContext(ctx, "RENAME TABLE traces_away TO traces"); err != nil {
		t.Fatal(err)
	}
	bump(t, db, "trc_x", t0.Add(time.Millisecond))
	tick <- time.Time{}
	ticks.next(t)
	w.cancel()

	if err := receive(t, w.err); err != nil {
		t.Errorf("err = %v, want nil", err)
	}
}

func TestFullBatchesDoNotStallThePoller(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		spacing time.Duration
		polls   int
	}{
		{"600 rows changed within the overlap", time.Millisecond, 2},
		{"600 rows changed in the same microsecond", 0, 3},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			db := migratedDB(t)
			_, err := db.ExecContext(t.Context(), `INSERT INTO traces (id, cache_key, language, source, stdin, options, updated_at, expires_at)
				WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 600)
				SELECT CONCAT('trc_', i), UNHEX(SHA2(CONCAT('trc_', i), 256)), 'python3', '', '', '{}', ? + INTERVAL i * ? MICROSECOND, ?
				FROM n`, t0, tt.spacing.Microseconds(), t0.Add(7*24*time.Hour))
			if err != nil {
				t.Fatal(err)
			}
			addTrace(t, db, "trc_x", t0.Add(-time.Hour))
			bump(t, db, "trc_x", t0.Add(900*time.Millisecond))
			p, ticks := startPoller(t, db)

			w := parkOnX(t, p, 0)
			for range tt.polls {
				ticks.fire(t)
			}
			ticks.next(t)
			w.cancel()

			if err := receive(t, w.err); err != nil {
				t.Errorf("after %d polls: err = %v, want nil", tt.polls, err)
			}
		})
	}
}

func TestWaitReturnsWithin400msOfAVersionBump(t *testing.T) {
	db := migratedDB(t)
	addTrace(t, db, "trc_x", time.Now())
	p := mysql.NewPoller(db, time.Now, time.After)
	runPoller(t, p)

	var slowest time.Duration
	for since := range int64(5) {
		w := parkOnX(t, p, since)
		bumped := time.Now()
		bump(t, db, "trc_x", bumped)
		if err := receive(t, w.err); err != nil {
			t.Fatal(err)
		}
		slowest = max(slowest, time.Since(bumped))
	}
	t.Logf("slowest wake-up: %v", slowest)
	if slowest > 400*time.Millisecond {
		t.Errorf("slowest wake-up took %v, want at most 400ms", slowest)
	}
}

func addTrace(t *testing.T, db *sql.DB, id string, updatedAt time.Time) {
	t.Helper()
	ctx := t.Context()
	err := mysql.InTx(ctx, db, func(tx *sql.Tx) error {
		return insertTrace(ctx, tx, id, updatedAt)
	})
	if err != nil {
		t.Fatal(err)
	}
}

func bump(t *testing.T, db *sql.DB, id string, now time.Time) {
	t.Helper()
	err := sqlc.New(db).SetTraceProgress(t.Context(), sqlc.SetTraceProgressParams{ProgressSteps: 1, Now: now, ID: id})
	if err != nil {
		t.Fatal(err)
	}
}

type ticks chan chan<- time.Time

func (c ticks) next(t *testing.T) chan<- time.Time {
	t.Helper()
	select {
	case tick := <-c:
		return tick
	case <-time.After(time.Minute):
		t.Fatal("poller asked for no tick within a minute")
		return nil
	}
}

func (c ticks) fire(t *testing.T) {
	t.Helper()
	c.next(t) <- time.Time{}
}

func startPoller(t *testing.T, db *sql.DB) (*mysql.Poller, ticks) {
	t.Helper()
	ctx := t.Context()
	c := make(ticks)
	after := func(time.Duration) <-chan time.Time {
		tick := make(chan time.Time, 1)
		select {
		case c <- tick:
		case <-ctx.Done():
		}
		return tick
	}
	p := mysql.NewPoller(db, func() time.Time { return t0 }, after)
	runPoller(t, p)
	return p, c
}

func runPoller(t *testing.T, p *mysql.Poller) {
	t.Helper()
	ctx, cancel := context.WithCancel(t.Context())
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		p.Run(ctx)
	}()
	t.Cleanup(func() {
		cancel()
		<-stopped
	})
}

type parked struct {
	cancel context.CancelFunc
	err    <-chan error
}

func parkOnX(t *testing.T, p *mysql.Poller, since int64) parked {
	ctx, cancel := context.WithCancel(t.Context())
	err := make(chan error, 1)
	go func() { err <- p.Wait(ctx, "trc_x", since) }()
	return parked{cancel: cancel, err: err}
}

func receive(t *testing.T, errs <-chan error) error {
	t.Helper()
	select {
	case err := <-errs:
		return err
	case <-time.After(time.Minute):
		t.Fatal("Wait did not return within a minute")
		return nil
	}
}

type refusingConnector struct {
	attempts atomic.Int64
}

func (c *refusingConnector) Connect(context.Context) (driver.Conn, error) {
	c.attempts.Add(1)
	return nil, errors.New("no database in this test")
}

func (c *refusingConnector) Driver() driver.Driver {
	return nil
}
