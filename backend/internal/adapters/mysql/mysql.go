package mysql

import (
	"database/sql"
	"fmt"

	gomysql "github.com/go-sql-driver/mysql"
)

// Open returns a connection pool for dsn. It does not connect.
func Open(dsn string) (*sql.DB, error) {
	cfg, err := gomysql.ParseDSN(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse dsn: %w", err)
	}
	cfg.ParseTime = true

	connector, err := gomysql.NewConnector(cfg)
	if err != nil {
		return nil, fmt.Errorf("new connector: %w", err)
	}
	return sql.OpenDB(connector), nil
}
