package app_test

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	gomysql "github.com/go-sql-driver/mysql"
	"github.com/testcontainers/testcontainers-go"
	tcexec "github.com/testcontainers/testcontainers-go/exec"

	"github.com/tu-hm/code-viz/backend/internal/adapters/mysql"
	"github.com/tu-hm/code-viz/backend/internal/app"
	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/api"
	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/internal/ports"
)

func BenchmarkPipeline(b *testing.B) {
	for _, steps := range []int{40, 1000} {
		for _, workers := range []int{1, 8, 32} {
			b.Run(fmt.Sprintf("steps=%d/workers=%d", steps, workers), func(b *testing.B) {
				benchPipeline(b, workers, loopWire(steps))
			})
		}
	}
}

func benchPipeline(b *testing.B, workers int, wire []string) {
	db := newDB(b)
	blobs := newBucket(b)
	adapters := fakeAdapters(b)
	sb := newFakeSandbox(func(_ context.Context, cmd ports.Command) (ports.Exit, error) {
		return ports.Exit{}, play(cmd, wire...)
	})
	viz := &app.Visualizations{
		Store:    mysql.NewStore(db, math.MaxInt32),
		Adapters: adapters,
		Blobs:    blobs,
		Events:   mysql.NewPoller(db, time.Now, time.After),
		Now:      func() time.Time { return time.Now().UTC() },
		Random:   rand.Reader,
	}

	ctx, stop := context.WithCancel(b.Context())
	var running sync.WaitGroup
	defer func() {
		stop()
		running.Wait()
	}()
	for range workers {
		w := newWorker(b, ownPool(b, db), adapters, sb, blobs)
		w.After = time.After
		running.Go(func() { w.Run(ctx) })
	}

	u := startLoad(b, db)
	b.ResetTimer()
	var next atomic.Int64
	var submitting sync.WaitGroup
	for range 8 {
		submitting.Go(func() {
			for i := next.Add(1); i <= int64(b.N); i = next.Add(1) {
				if _, err := viz.Create(ctx, benchCaller(i), "", benchRequest(i)); err != nil {
					b.Errorf("create %d: %v", i, err)
					return
				}
			}
		})
	}
	submitting.Wait()
	awaitFinished(b, db, b.N)
	b.StopTimer()

	u.report(b, db, "job")
	b.ReportMetric(float64(b.N)/b.Elapsed().Seconds(), "jobs/s")
	b.ReportMetric(float64(workers)*b.Elapsed().Seconds()*1000/float64(b.N), "worker-ms/job")
}

func BenchmarkCreate(b *testing.B) {
	db := newDB(b)
	viz := &app.Visualizations{
		Store:    mysql.NewStore(db, math.MaxInt32),
		Adapters: fakeAdapters(b),
		Blobs:    newBucket(b),
		Events:   mysql.NewPoller(db, time.Now, time.After),
		Now:      func() time.Time { return time.Now().UTC() },
		Random:   rand.Reader,
	}
	ctx, stop := context.WithCancel(b.Context())
	drained := make(chan struct{})
	go func() {
		defer close(drained)
		drainQueue(ctx, b, db)
	}()

	u := startLoad(b, db)
	b.ResetTimer()
	var next atomic.Int64
	b.SetParallelism(4)
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			i := next.Add(1)
			if _, err := viz.Create(ctx, benchCaller(i), "", benchRequest(i)); err != nil {
				b.Errorf("create %d: %v", i, err)
				return
			}
		}
	})
	b.StopTimer()
	stop()
	<-drained
	u.report(b, db, "op")
}

func BenchmarkClaimEmptyQueue(b *testing.B) {
	db := newDB(b)
	q := mysql.NewQueue(db)
	var next atomic.Int64

	u := startLoad(b, db)
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		worker := fmt.Sprintf("idle%d", next.Add(1))
		for pb.Next() {
			if _, err := q.Claim(b.Context(), worker, time.Now()); !errors.Is(err, domain.ErrNoJob) {
				b.Errorf("claim on an empty queue: %v", err)
				return
			}
		}
	})
	b.StopTimer()
	u.report(b, db, "op")
}

func loopWire(steps int) []string {
	const internals = `{"name":"__name__","value":{"t":"str","v":"__main__"},"internal":true},` +
		`{"name":"__doc__","value":{"t":"none"},"internal":true},{"name":"__package__","value":{"t":"none"},"internal":true},` +
		`{"name":"__loader__","value":{"t":"none"},"internal":true},{"name":"__spec__","value":{"t":"none"},"internal":true},` +
		`{"name":"__builtins__","value":{"t":"ref","id":"281473469661808"},"internal":true}`
	const heap = `{"281473469661808":{"kind":"opaque","type":"module","summary":"<module 'builtins' (built-in)>"}}`
	lines := []string{fakeHello}
	total := 0
	for i := range steps {
		line, prev := 2+i%2, 3-i%2
		if i%2 == 1 {
			total += i / 2
		}
		lines = append(lines, fmt.Sprintf(`{"type":"step","event":"line","line":%d,"prevLine":%d,`+
			`"stack":[{"id":"0","name":"<module>","kind":"global","line":%d,"locals":[%s,`+
			`{"name":"total","value":{"t":"int","v":"%d"}},{"name":"i","value":{"t":"int","v":"%d"}}],"returnValue":null}],`+
			`"heap":%s,"error":null,"stdinPos":{"bytes":0,"token":0,"inferred":false}}`,
			line, prev, line, internals, total, i/2, heap))
	}
	return append(lines, `{"type":"out","stream":"stdout","data":"1999000\n"}`, fakeExit)
}

func benchCaller(i int64) app.Caller {
	return app.Caller{Subject: "ip:bench" + strconv.FormatInt(i, 10)}
}

func benchRequest(i int64) api.CreateVisualizationRequest {
	source := fmt.Sprintf("total = %d\nfor i in range(2000):\n    total += i\nprint(total)\n", i)
	return api.CreateVisualizationRequest{Language: "fake", Source: source, Options: trace.Options{MaxSteps: 1000, StartAtLines: []int{}}}
}

func ownPool(b *testing.B, db *sql.DB) *sql.DB {
	b.Helper()
	var name string
	if err := db.QueryRowContext(b.Context(), "SELECT DATABASE()").Scan(&name); err != nil {
		b.Fatal(err)
	}
	cfg, err := gomysql.ParseDSN(rootDSN)
	if err != nil {
		b.Fatal(err)
	}
	cfg.DBName = name
	pool, err := mysql.Open(cfg.FormatDSN())
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() {
		if err := pool.Close(); err != nil {
			b.Error(err)
		}
	})
	return pool
}

func awaitFinished(b *testing.B, db *sql.DB, n int) {
	b.Helper()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for range tick.C {
		var finished, failed int
		err := db.QueryRowContext(b.Context(),
			"SELECT COUNT(*), COALESCE(SUM(status = 'failed'), 0) FROM traces WHERE status IN ('completed', 'failed')").Scan(&finished, &failed)
		if err != nil {
			b.Fatal(err)
		}
		if failed > 0 {
			b.Fatalf("%d of %d traces failed", failed, n)
		}
		if finished == n {
			return
		}
	}
}

func drainQueue(ctx context.Context, b *testing.B, db *sql.DB) {
	tick := time.NewTicker(100 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		if _, err := db.ExecContext(ctx, "UPDATE jobs SET status = 'done' WHERE status = 'queued'"); err != nil && ctx.Err() == nil {
			b.Error(err)
			return
		}
	}
}

type load struct {
	start          time.Time
	goCPU          time.Duration
	mysqlCPU       time.Duration
	s3CPU          time.Duration
	connections    int
	commits        int
	lockWaitMillis int
}

func startLoad(b *testing.B, db *sql.DB) load {
	b.Helper()
	return load{
		start:          time.Now(),
		goCPU:          processCPU(b),
		mysqlCPU:       containerCPU(b, mysqlContainer),
		s3CPU:          containerCPU(b, s3Container),
		connections:    globalStatus(b, db, "Connections"),
		commits:        globalStatus(b, db, "Com_commit"),
		lockWaitMillis: globalStatus(b, db, "Innodb_row_lock_time"),
	}
}

func (u load) report(b *testing.B, db *sql.DB, unit string) {
	b.Helper()
	n := float64(b.N)
	wall := time.Since(u.start).Seconds()
	goCPU := processCPU(b) - u.goCPU
	mysqlCPU := containerCPU(b, mysqlContainer) - u.mysqlCPU
	s3CPU := containerCPU(b, s3Container) - u.s3CPU
	b.ReportMetric(float64(goCPU.Microseconds())/1000/n, "go-cpu-ms/"+unit)
	b.ReportMetric(float64(mysqlCPU.Microseconds())/1000/n, "mysql-cpu-ms/"+unit)
	b.ReportMetric(float64(s3CPU.Microseconds())/1000/n, "s3-cpu-ms/"+unit)
	b.ReportMetric(mysqlCPU.Seconds()/wall, "mysql-cores")
	b.ReportMetric(float64(globalStatus(b, db, "Connections")-u.connections)/n, "conns/"+unit)
	b.ReportMetric(float64(globalStatus(b, db, "Com_commit")-u.commits)/n, "commits/"+unit)
	b.ReportMetric(float64(globalStatus(b, db, "Innodb_row_lock_time")-u.lockWaitMillis)/n, "lock-wait-ms/"+unit)
}

func processCPU(b *testing.B) time.Duration {
	b.Helper()
	var ru syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &ru); err != nil {
		b.Fatal(err)
	}
	return time.Duration(ru.Utime.Nano() + ru.Stime.Nano())
}

func containerCPU(b *testing.B, c testcontainers.Container) time.Duration {
	b.Helper()
	code, out, err := c.Exec(b.Context(), []string{"cat", "/sys/fs/cgroup/cpu.stat"}, tcexec.Multiplexed())
	if err != nil || code != 0 {
		b.Fatalf("read cpu.stat: exit %d: %v", code, err)
	}
	stat, err := io.ReadAll(out)
	if err != nil {
		b.Fatal(err)
	}
	for _, line := range strings.Split(string(stat), "\n") {
		usec, ok := strings.CutPrefix(line, "usage_usec ")
		if !ok {
			continue
		}
		n, err := strconv.ParseInt(usec, 10, 64)
		if err != nil {
			b.Fatal(err)
		}
		return time.Duration(n) * time.Microsecond
	}
	b.Fatalf("no usage_usec in cpu.stat: %q", stat)
	return 0
}

func globalStatus(b *testing.B, db *sql.DB, name string) int {
	b.Helper()
	rows, err := db.QueryContext(b.Context(), "SHOW GLOBAL STATUS")
	if err != nil {
		b.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			b.Fatal(err)
		}
		if key != name {
			continue
		}
		n, err := strconv.Atoi(value)
		if err != nil {
			b.Fatal(err)
		}
		return n
	}
	if err := rows.Err(); err != nil {
		b.Fatal(err)
	}
	b.Fatalf("no global status %s", name)
	return 0
}
