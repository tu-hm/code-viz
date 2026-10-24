package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/caarlos0/env/v11"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/tu-hm/code-viz/backend/internal/adapters/blobstore"
	"github.com/tu-hm/code-viz/backend/internal/adapters/dockersandbox"
	"github.com/tu-hm/code-viz/backend/internal/adapters/manifest"
	"github.com/tu-hm/code-viz/backend/internal/adapters/mysql"
	"github.com/tu-hm/code-viz/backend/internal/app"
	"github.com/tu-hm/code-viz/backend/internal/ports"
	httptransport "github.com/tu-hm/code-viz/backend/internal/transport/http"
	"github.com/tu-hm/code-viz/backend/schema"
)

const drainTimeout = 25 * time.Second // §13

type config struct {
	HTTPAddr string `env:"VIZ_HTTP_ADDR" envDefault:":8080"`
	MySQLDSN string `env:"MYSQL_DSN,required"`
	Env      string `env:"VIZ_ENV,required"`
	Sandbox  string `env:"VIZ_SANDBOX"`
	Metrics  bool   `env:"VIZ_METRICS"`
	OTLP     string `env:"OTEL_EXPORTER_OTLP_ENDPOINT"`
}

func main() {
	slog.SetDefault(slog.New(spanHandler{slog.NewJSONHandler(os.Stdout, nil)}))

	if err := run(); err != nil {
		slog.Error("vizd stopped", "err", err)
		os.Exit(1)
	}
}

func run() (err error) {
	role := flag.String("role", "", "api, worker or all")
	flag.Parse()

	var cfg config
	if err := env.Parse(&cfg); err != nil {
		return fmt.Errorf("load config: %w", err)
	}
	sandbox, err := pickSandbox(cfg.Env, cfg.Sandbox)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}
	if sandbox == "docker" {
		slog.Warn("docker sandbox is not a security boundary", "viz_env", cfg.Env)
	}

	db, err := mysql.Open(cfg.MySQLDSN)
	if err != nil {
		return fmt.Errorf("open mysql: %w", err)
	}
	defer func() {
		if cerr := db.Close(); cerr != nil {
			err = errors.Join(err, fmt.Errorf("close mysql: %w", cerr))
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	switch flag.Arg(0) {
	case "migrate":
		return mysql.Migrate(ctx, db, flag.Arg(1))
	}

	if *role != "api" && *role != "worker" && *role != "all" {
		return fmt.Errorf("--role must be api, worker or all, got %q", *role)
	}
	stopTracing, err := startTracing(ctx, *role, cfg.OTLP)
	if err != nil {
		return err
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if serr := stopTracing(ctx); serr != nil {
			err = errors.Join(err, fmt.Errorf("flush spans: %w", serr))
		}
	}()
	mux := http.NewServeMux()
	// TODO(tu-hm): add the sandbox self-check to readyz for worker and all once BE-02 lands
	httptransport.HandleProbes(mux, ctx.Done(), db.PingContext)
	reg := prometheus.NewRegistry()
	reg.MustRegister(collectors.NewGoCollector(), collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
	if cfg.Metrics {
		mux.Handle("GET /metrics", promhttp.HandlerFor(reg, promhttp.HandlerOpts{}))
	}

	// poller outlives SIGTERM until http shuts down => long-polls keep parking while the worker drains
	polling, stopPolling := context.WithCancel(context.WithoutCancel(ctx))
	var background sync.WaitGroup
	defer func() {
		stop()
		stopPolling()
		background.Wait()
	}()
	if *role != "worker" {
		viz, poller, err := newAPI(ctx, db, mux, reg)
		if err != nil {
			return err
		}
		background.Go(func() { poller.Run(polling) })
		// api role, not worker: worker's db user and s3 key can't delete (BE-13 §4, §12)
		background.Go(func() { cleanDaily(ctx, viz) })
	}

	worked := make(chan struct{})
	if *role == "api" {
		close(worked)
	} else {
		w, closeSandbox, err := newWorker(ctx, sandbox, db, reg)
		if err != nil {
			return err
		}
		defer func() {
			if cerr := closeSandbox(); cerr != nil {
				err = errors.Join(err, fmt.Errorf("close sandbox: %w", cerr))
			}
		}()
		go func() {
			defer close(worked)
			w.Run(ctx)
		}()
	}
	err = serve(ctx, cfg.HTTPAddr, mux, worked, stopPolling)
	stop()
	<-worked
	return err
}

type apiConfig struct {
	AdaptersDir      string   `env:"VIZ_ADAPTERS_DIR" envDefault:"adapters"`
	S3Endpoint       string   `env:"S3_ENDPOINT"`
	S3PublicEndpoint string   `env:"S3_PUBLIC_ENDPOINT"`
	S3Bucket         string   `env:"S3_BUCKET,required"`
	S3PathStyle      bool     `env:"S3_PATH_STYLE"`
	CORSOrigins      []string `env:"CORS_ORIGINS"`
	WebOrigin        string   `env:"VIZ_WEB_ORIGIN,required"`
	IPHashKey        string   `env:"VIZ_IP_HASH_KEY,required"`
	Slots            int      `env:"VIZ_SLOTS,required"`
}

func newAPI(ctx context.Context, db *sql.DB, mux *http.ServeMux, reg prometheus.Registerer) (*app.Visualizations, *mysql.Poller, error) {
	var cfg apiConfig
	if err := env.Parse(&cfg); err != nil {
		return nil, nil, fmt.Errorf("load api config: %w", err)
	}
	if cfg.Slots < 1 {
		return nil, nil, fmt.Errorf("load api config: VIZ_SLOTS must be 1 or more, got %d", cfg.Slots)
	}
	if len(cfg.IPHashKey) < 32 {
		return nil, nil, errors.New("load api config: VIZ_IP_HASH_KEY must be 32 bytes or more")
	}
	adapters, err := manifest.Load(cfg.AdaptersDir)
	if err != nil {
		return nil, nil, fmt.Errorf("load manifests: %w", err)
	}
	blobs, err := blobstore.New(ctx, blobstore.Config{
		Endpoint:       cfg.S3Endpoint,
		PublicEndpoint: cfg.S3PublicEndpoint,
		Bucket:         cfg.S3Bucket,
		PathStyle:      cfg.S3PathStyle,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("open blob store: %w", err)
	}

	poller := mysql.NewPoller(db, time.Now, time.After)
	viz := &app.Visualizations{
		Store:     mysql.NewStore(db, cfg.Slots*10),
		Adapters:  adapters,
		Blobs:     blobs,
		Events:    poller,
		Now:       func() time.Time { return time.Now().UTC() },
		Random:    rand.Reader,
		WebOrigin: cfg.WebOrigin,
	}
	httptransport.HandleAPI(mux, viz, []byte(cfg.IPHashKey), cfg.CORSOrigins, reg)
	reg.MustRegister(mysql.NewQueueDepth(db))
	return viz, poller, nil
}

func cleanDaily(ctx context.Context, viz *app.Visualizations) {
	for {
		if err := viz.Cleanup(ctx, viz.Now()); err != nil && ctx.Err() == nil {
			slog.ErrorContext(ctx, "clean up expired visualizations", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(24 * time.Hour):
		}
	}
}

type workerConfig struct {
	AdaptersDir string `env:"VIZ_ADAPTERS_DIR" envDefault:"adapters"`
	S3Endpoint  string `env:"S3_ENDPOINT"`
	S3Bucket    string `env:"S3_BUCKET,required"`
	S3PathStyle bool   `env:"S3_PATH_STYLE"`
}

func newWorker(ctx context.Context, sandbox string, db *sql.DB, reg prometheus.Registerer) (*app.Worker, func() error, error) {
	var cfg workerConfig
	if err := env.Parse(&cfg); err != nil {
		return nil, nil, fmt.Errorf("load worker config: %w", err)
	}
	adapters, err := manifest.Load(cfg.AdaptersDir)
	if err != nil {
		return nil, nil, fmt.Errorf("load manifests: %w", err)
	}
	val, err := schema.New()
	if err != nil {
		return nil, nil, fmt.Errorf("compile schemas: %w", err)
	}
	blobs, err := blobstore.New(ctx, blobstore.Config{Endpoint: cfg.S3Endpoint, Bucket: cfg.S3Bucket, PathStyle: cfg.S3PathStyle})
	if err != nil {
		return nil, nil, fmt.Errorf("open blob store: %w", err)
	}

	name, err := workerName()
	if err != nil {
		return nil, nil, err
	}
	sb, closeSandbox, err := openSandbox(ctx, sandbox)
	if err != nil {
		return nil, nil, fmt.Errorf("open %s sandbox: %w", sandbox, err)
	}

	return &app.Worker{
		Name:     name,
		Queue:    mysql.NewQueue(db),
		Adapters: adapters,
		Sandbox:  sb,
		Blobs:    blobs,
		Validate: val.Wire,
		Now:      time.Now,
		After:    time.After,
		Metrics:  app.NewWorkerMetrics(reg),
	}, closeSandbox, nil
}

func openSandbox(ctx context.Context, sandbox string) (ports.Sandbox, func() error, error) {
	if sandbox == "nsjail" {
		sb, err := openNsjail(ctx)
		return sb, func() error { return nil }, err
	}
	sb, err := dockersandbox.New(ctx)
	if err != nil {
		return nil, nil, err
	}
	return sb, sb.Close, nil
}

// workerName is the hostname plus a random suffix: two processes on one host, or one restarted, never share a lease.
func workerName() (string, error) {
	host, err := os.Hostname()
	if err != nil {
		return "", fmt.Errorf("hostname: %w", err)
	}
	suffix := make([]byte, 4)
	rand.Read(suffix)
	return fmt.Sprintf("%.55s-%x", host, suffix), nil // leased_by is VARCHAR(64)
}

func pickSandbox(vizEnv, sandbox string) (string, error) {
	switch vizEnv {
	case "dev", "test", "staging", "prod":
	default:
		return "", fmt.Errorf("VIZ_ENV must be dev, test, staging or prod, got %q", vizEnv)
	}
	if sandbox == "" && vizEnv == "dev" {
		return "docker", nil
	}
	switch sandbox {
	case "nsjail":
		return sandbox, nil
	case "docker":
		if vizEnv != "dev" && vizEnv != "test" {
			return "", fmt.Errorf("VIZ_SANDBOX=docker is not a security boundary, refused with VIZ_ENV=%s", vizEnv)
		}
		return sandbox, nil
	}
	return "", fmt.Errorf("VIZ_SANDBOX must be docker or nsjail, got %q", sandbox)
}

// serve answers HTTP until ctx is done, and shuts down once worked is closed: probes keep answering while the worker drains.
func serve(ctx context.Context, addr string, h http.Handler, worked <-chan struct{}, onShutdown func()) error {
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", addr, err)
	}

	srv := &http.Server{
		Handler:           h,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      30 * time.Second, // long-poll GET holds up to 20 s (§8.3)
	}
	srv.RegisterOnShutdown(onShutdown)
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()
	slog.InfoContext(ctx, "http listening", "addr", ln.Addr().String())

	select {
	case err := <-errc:
		return fmt.Errorf("serve http: %w", err)
	case <-ctx.Done():
	}
	<-worked

	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), drainTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shut down http: %w", err)
	}
	return nil
}
