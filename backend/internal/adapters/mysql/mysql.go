package mysql

import (
	"database/sql"
	"fmt"
	"time"

	gomysql "github.com/go-sql-driver/mysql"
)

// Open returns a connection pool for dsn whose sessions run in READ COMMITTED and UTC (§7.13). It does not connect.
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
	return sql.OpenDB(connector), nil
}
