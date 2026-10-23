package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/caarlos0/env/v11"

	"github.com/tu-hm/code-viz/backend/internal/adapters/mysql"
	httptransport "github.com/tu-hm/code-viz/backend/internal/transport/http"
)

const drainTimeout = 25 * time.Second // §13

type config struct {
	HTTPAddr string `env:"VIZ_HTTP_ADDR" envDefault:":8080"`
	MySQLDSN string `env:"MYSQL_DSN,required"`
	Env      string `env:"VIZ_ENV,required"`
	Sandbox  string `env:"VIZ_SANDBOX"`
}

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

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

	if flag.Arg(0) == "migrate" {
		return mysql.Migrate(ctx, db, flag.Arg(1))
	}

	if *role != "api" && *role != "worker" && *role != "all" {
		return fmt.Errorf("--role must be api, worker or all, got %q", *role)
	}
	mux := http.NewServeMux()
	// TODO(tu-hm): add the sandbox self-check to readyz for worker and all once BE-02 lands
	httptransport.HandleProbes(mux, ctx.Done(), db.PingContext)
	// TODO(tu-hm): claim and run jobs under worker and all once BE-05 lands; drain them before http shutdown
	return serve(ctx, cfg.HTTPAddr, mux)
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

func serve(ctx context.Context, addr string, h http.Handler) error {
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", addr, err)
	}

	srv := &http.Server{
		Handler:           h,
		ReadHeaderTimeout: 5 * time.Second,
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()
	slog.InfoContext(ctx, "http listening", "addr", ln.Addr().String())

	select {
	case err := <-errc:
		return fmt.Errorf("serve http: %w", err)
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), drainTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shut down http: %w", err)
	}
	return nil
}
