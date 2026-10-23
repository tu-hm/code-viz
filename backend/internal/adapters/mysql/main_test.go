package mysql_test

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"sync/atomic"
	"testing"

	gomysql "github.com/go-sql-driver/mysql"
	"github.com/testcontainers/testcontainers-go"
	tcmysql "github.com/testcontainers/testcontainers-go/modules/mysql"

	"github.com/tu-hm/code-viz/backend/internal/adapters/mysql"
)

var (
	rootDSN string
	dbCount atomic.Int64
)

func TestMain(m *testing.M) {
	os.Exit(run(m))
}

func run(m *testing.M) int {
	ctx := context.Background()
	c, err := tcmysql.Run(ctx, "mysql:8.4.13", tcmysql.WithUsername("root"), tcmysql.WithPassword("test"))
	defer func() {
		if err := testcontainers.TerminateContainer(c); err != nil {
			fmt.Fprintf(os.Stderr, "terminate mysql: %v\n", err)
		}
	}()
	if err != nil {
		fmt.Fprintf(os.Stderr, "start mysql: %v\n", err)
		return 1
	}
	rootDSN, err = c.ConnectionString(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "mysql dsn: %v\n", err)
		return 1
	}
	return m.Run()
}

func newDatabase(t *testing.T) *gomysql.Config {
	t.Helper()
	root, err := mysql.Open(rootDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer closeDB(t, root)
	name := fmt.Sprintf("test%d", dbCount.Add(1))
	if _, err := root.ExecContext(t.Context(), "CREATE DATABASE "+name); err != nil {
		t.Fatal(err)
	}

	cfg, err := gomysql.ParseDSN(rootDSN)
	if err != nil {
		t.Fatal(err)
	}
	cfg.DBName = name
	return cfg
}

func open(t *testing.T, cfg *gomysql.Config) *sql.DB {
	t.Helper()
	db, err := mysql.Open(cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { closeDB(t, db) })
	return db
}

func emptyDB(t *testing.T) *sql.DB {
	t.Helper()
	return open(t, newDatabase(t))
}

func closeDB(t *testing.T, db *sql.DB) {
	t.Helper()
	if err := db.Close(); err != nil {
		t.Error(err)
	}
}
