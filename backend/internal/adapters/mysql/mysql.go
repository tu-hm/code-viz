package mysql

import (
	"database/sql"
	"fmt"
	"time"

	gomysql "github.com/go-sql-driver/mysql"
)

const (
	maxConns    = 32              // per process: api, worker and migrate on one server stay under MySQL's 151 (§7.13)
	connMaxLife = 3 * time.Minute // go-sql-driver: close before MySQL, the OS or a proxy drops the connection
)

// Open returns a connection pool for dsn whose sessions run in READ COMMITTED and UTC (§7.13). The pool keeps up to
// 32 connections, open and idle, and replaces each after 3 minutes. It does not connect.
func Open(dsn string) (*sql.DB, error) {
	cfg, err := gomysql.ParseDSN(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse dsn: %w", err)
	}
	cfg.ParseTime = true
	cfg.Loc = time.UTC
	if cfg.Params == nil {
		cfg.Params = map[string]string{}
	}
	cfg.Params["transaction_isolation"] = "'READ-COMMITTED'"
	cfg.Params["time_zone"] = "'+00:00'"

	connector, err := gomysql.NewConnector(cfg)
	if err != nil {
		return nil, fmt.Errorf("new connector: %w", err)
	}
	db := sql.OpenDB(connector)
	db.SetMaxOpenConns(maxConns)
	db.SetMaxIdleConns(maxConns)
	db.SetConnMaxLifetime(connMaxLife)
	return db, nil
}
