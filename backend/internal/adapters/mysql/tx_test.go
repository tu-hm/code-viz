package mysql_test

import (
	"context"
	"database/sql"
	"errors"
	"sync/atomic"
	"testing"

	gomysql "github.com/go-sql-driver/mysql"

	"github.com/tu-hm/code-viz/backend/internal/adapters/mysql"
)

func TestInTxRetriesTheVictimOfARealDeadlock(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	db := migratedDB(t)
	if _, err := db.ExecContext(ctx, "INSERT INTO feature_flags (name, rollout_percent) VALUES ('a', 0), ('b', 0)"); err != nil {
		t.Fatal(err)
	}

	var tries atomic.Int32
	aLocked, bLocked := make(chan struct{}), make(chan struct{})
	lockBoth := func(first, second string, mine, theirs chan struct{}) func(tx *sql.Tx) error {
		var mineTries int
		return func(tx *sql.Tx) error {
			tries.Add(1)
			mineTries++
			if err := lockFlag(ctx, tx, first); err != nil {
				return err
			}
			if mineTries == 1 {
				close(mine)
				<-theirs
			}
			return lockFlag(ctx, tx, second)
		}
	}

	errs := make(chan error, 2)
	go func() { errs <- mysql.InTx(ctx, db, lockBoth("a", "b", aLocked, bLocked)) }()
	go func() { errs <- mysql.InTx(ctx, db, lockBoth("b", "a", bLocked, aLocked)) }()
	for range 2 {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	if got := tries.Load(); got != 3 {
		t.Errorf("transactions ran %d times, want 3", got)
	}
}

func lockFlag(ctx context.Context, tx *sql.Tx, name string) error {
	var got string
	return tx.QueryRowContext(ctx, "SELECT name FROM feature_flags WHERE name = ? FOR UPDATE", name).Scan(&got)
}

func TestInTxRetries(t *testing.T) {
	t.Parallel()
	db := migratedDB(t)
	tests := []struct {
		name  string
		err   error
		tries int32
	}{
		{"deadlock is tried 3 times", &gomysql.MySQLError{Number: 1213}, 3},
		{"lock wait timeout is tried 3 times", &gomysql.MySQLError{Number: 1205}, 3},
		{"wrapped deadlock is tried 3 times", errors.Join(errors.New("claim"), &gomysql.MySQLError{Number: 1213}), 3},
		{"duplicate key is tried once", &gomysql.MySQLError{Number: 1062}, 1},
		{"other error is tried once", errors.New("boom"), 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var tries int32
			err := mysql.InTx(t.Context(), db, func(*sql.Tx) error {
				tries++
				return tt.err
			})
			if !errors.Is(err, tt.err) {
				t.Errorf("err = %v, want %v", err, tt.err)
			}
			if tries != tt.tries {
				t.Errorf("tries = %d, want %d", tries, tt.tries)
			}
		})
	}
}
