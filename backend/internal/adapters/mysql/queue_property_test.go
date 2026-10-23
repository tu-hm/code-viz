package mysql_test

import (
	"errors"
	"fmt"
	"math/rand/v2"
	"testing"
	"time"

	"github.com/tu-hm/code-viz/backend/internal/adapters/mysql"
	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/api"
	"github.com/tu-hm/code-viz/backend/internal/ports"
)

func TestNoJobIsLostOrCompletedTwiceWhenWorkersDieAtRandom(t *testing.T) {
	t.Parallel()
	seed := rand.Uint64()
	t.Logf("seed %d", seed)
	db, q := newQueue(t)
	f := &fleet{t: t, r: rand.New(rand.NewPCG(seed, seed)), q: q, now: t0, completed: map[string]int{}}

	traces := make([]string, 150)
	for i := range traces {
		traces[i] = addJob(t, db, q, f.r.IntN(2) == 0, t0)
	}
	for range 4 {
		f.workers = append(f.workers, f.spawn())
	}
	for range 3000 {
		f.step()
	}
	f.drain()
	t.Logf("claims %d, leases lost %d, rescued %d, workers %d", f.claims, f.lost, f.rescued, f.spawned)

	for _, id := range traces {
		tr, job := readTrace(t, db, id), readJob(t, db, id)
		switch {
		case tr.Status == "completed" && job.Status == "done" && f.completed[id] == 1:
		case tr.Status == "failed" && job.Status == "failed" && f.completed[id] == 0:
		default:
			t.Errorf("seed %d: trace %s is %s, its job %s, completed %d times", seed, id, tr.Status, job.Status, f.completed[id])
		}
	}
}

type fleet struct {
	t         *testing.T
	r         *rand.Rand
	q         *mysql.Queue
	now       time.Time
	workers   []*fleetWorker
	spawned   int
	completed map[string]int

	claims, lost, rescued int
}

type fleetWorker struct {
	name  string
	job   *ports.Job
	stage int
}

func (f *fleet) spawn() *fleetWorker {
	f.spawned++
	return &fleetWorker{name: fmt.Sprintf("w%d", f.spawned)}
}

func (f *fleet) step() {
	switch roll := f.r.IntN(100); {
	case roll < 5:
		f.workers[f.r.IntN(len(f.workers))] = f.spawn()
	case roll < 15:
		f.now = f.now.Add(time.Duration(f.r.IntN(30)) * time.Second)
	case roll < 20:
		f.rescue()
	default:
		f.work(f.workers[f.r.IntN(len(f.workers))], true)
	}
}

func (f *fleet) drain() {
	f.now = f.now.Add(time.Minute)
	f.rescue()
	w := f.spawn()
	for {
		f.work(w, false)
		if w.job == nil {
			return
		}
		for w.job != nil {
			f.work(w, false)
		}
	}
}

func (f *fleet) rescue() {
	n, err := f.q.Rescue(f.t.Context(), f.now)
	if err != nil {
		f.t.Fatal(err)
	}
	f.rescued += n
}

func (f *fleet) work(w *fleetWorker, chaos bool) {
	ctx := f.t.Context()
	if w.job == nil {
		job, err := f.q.Claim(ctx, w.name, f.now)
		if errors.Is(err, domain.ErrNoJob) {
			return
		}
		if err != nil {
			f.t.Fatal(err)
		}
		f.claims++
		w.job, w.stage = &job, 0
		return
	}

	l := w.job.Lease
	var err error
	switch w.stage {
	case 0:
		err = f.q.Building(ctx, l, f.now)
	case 1:
		err = f.q.Tracing(ctx, l, f.now)
	case 2:
		err = f.q.Progress(ctx, l, f.r.IntN(1000), f.now)
	case 3:
		err = f.q.CheckLease(ctx, l)
	default:
		err = f.finish(l, chaos)
	}
	if errors.Is(err, domain.ErrLeaseLost) {
		f.lost++
		w.job = nil
		return
	}
	if err != nil {
		f.t.Fatal(err)
	}
	w.stage++
	if w.stage > 4 {
		w.job = nil
	}
}

func (f *fleet) finish(l ports.Lease, chaos bool) error {
	ctx := f.t.Context()
	roll := f.r.IntN(100)
	switch {
	case chaos && roll < 10:
		return f.q.Requeue(ctx, l, f.now)
	case chaos && roll < 15:
		return f.q.Fail(ctx, l, api.FailureKindCompileError, nil, f.now)
	}
	err := f.q.Complete(ctx, l, completedTrace(), f.now)
	if err == nil {
		f.completed[l.TraceID]++
	}
	return err
}
