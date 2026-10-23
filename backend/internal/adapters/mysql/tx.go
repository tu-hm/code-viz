package mysql

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/rand/v2"
	"time"

	gomysql "github.com/go-sql-driver/mysql"
)

const (
	txTries  = 3
	txJitter = 10 * time.Millisecond
)

// InTx runs fn in a transaction and commits it. On a deadlock (1213) or lock wait timeout (1205) it rolls back and runs fn again, up to 3 tries in all (§7.13.4).
func InTx(ctx context.Context, db *sql.DB, fn func(tx *sql.Tx) error) error {
	var err error
	for try := range txTries {
		if try > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(rand.N(txJitter << try)): //nolint:gosec // retry jitter, not a secret
			}
		}
		err = runTx(ctx, db, fn)
		var myErr *gomysql.MySQLError
		if !errors.As(err, &myErr) || (myErr.Number != 1213 && myErr.Number != 1205) {
			return err
		}
	}
	return err
}

func runTx(ctx context.Context, db *sql.DB, fn func(tx *sql.Tx) error) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	if err := fn(tx); err != nil {
		if rerr := tx.Rollback(); rerr != nil && !errors.Is(rerr, sql.ErrTxDone) {
			return errors.Join(err, fmt.Errorf("rollback: %w", rerr))
		}
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}
