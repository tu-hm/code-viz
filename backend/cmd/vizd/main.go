package main

import (
	"context"
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
)

const drainTimeout = 25 * time.Second // §13

type config struct {
	HTTPAddr string `env:"VIZ_HTTP_ADDR" envDefault:":8080"`
}

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	if err := run(); err != nil {
		slog.Error("vizd stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	role := flag.String("role", "", "api, worker or all")
	flag.Parse()

	var cfg config
	if err := env.Parse(&cfg); err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	switch *role {
	case "api", "all":
		return serveAPI(ctx, cfg.HTTPAddr)
	case "worker":
		// TODO(tu-hm): claim and run jobs here and under "all" once BE-05 lands
		<-ctx.Done()
		return nil
	}
	return fmt.Errorf("--role must be api, worker or all, got %q", *role)
}

func serveAPI(ctx context.Context, addr string) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", addr, err)
	}

	srv := &http.Server{
		Handler:           http.NewServeMux(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()
	slog.InfoContext(ctx, "api listening", "addr", ln.Addr().String())

	select {
	case err := <-errc:
		return fmt.Errorf("serve api: %w", err)
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), drainTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shut down api: %w", err)
	}
	return nil
}
