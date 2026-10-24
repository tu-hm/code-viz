package mysql_test

import (
	"context"
	"database/sql"
	"errors"
	"net"
	"testing"

	gomysql "github.com/go-sql-driver/mysql"

	"github.com/tu-hm/code-viz/backend/internal/adapters/mysql"
	"github.com/tu-hm/code-viz/backend/internal/domain"
	"github.com/tu-hm/code-viz/backend/internal/gen/trace"
	"github.com/tu-hm/code-viz/backend/internal/ports"
)

var _ ports.MetaStore = (*mysql.Store)(nil)

func TestStoreErrorsWrapErrInfraOnlyWhenMySQLIsUnreachable(t *testing.T) {
	t.Parallel()
	calls := []struct {
		name string
		call func(ctx context.Context, s *mysql.Store) error
	}{
		{"create", func(ctx context.Context, s *mysql.Store) error {
			_, err := s.Create(ctx, ports.NewVisualization{
				ID:       "viz_1",
				TraceID:  "trc_1",
				Subject:  "ip:1",
				Language: "python3",
				Options:  trace.Options{MaxSteps: 1000, StartAtLines: []int{}},
			}, t0)
			return err
		}},
		{"visualization", func(ctx context.Context, s *mysql.Store) error {
			_, err := s.Visualization(ctx, "viz_1")
			return err
		}},
		{"detach", func(ctx context.Context, s *mysql.Store) error {
			return s.Detach(ctx, "viz_1", "ip:1", t0)
		}},
		{"delete expired", func(ctx context.Context, s *mysql.Store) error {
			_, err := s.DeleteExpired(ctx, t0)
			return err
		}},
	}
	dbs := []struct {
		name  string
		db    *sql.DB
		infra bool
	}{
		{"unreachable server", unreachableDB(t), true},
		{"server error", emptyDB(t), false},
	}
	for _, d := range dbs {
		for _, c := range calls {
			t.Run(d.name+"/"+c.name, func(t *testing.T) {
				err := c.call(t.Context(), mysql.NewStore(d.db, 10))
				if err == nil {
					t.Fatal("err = nil")
				}
				if errors.Is(err, domain.ErrInfra) != d.infra {
					t.Errorf("err = %v, wraps ErrInfra: %t, want %t", err, !d.infra, d.infra)
				}
			})
		}
	}
}

func unreachableDB(t *testing.T) *sql.DB {
	t.Helper()
	var lc net.ListenConfig
	ln, err := lc.Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	if err := ln.Close(); err != nil {
		t.Fatal(err)
	}
	cfg := gomysql.NewConfig()
	cfg.Net, cfg.Addr, cfg.User, cfg.DBName = "tcp", ln.Addr().String(), "root", "gone"
	return open(t, cfg)
}
