package mysql_test

import (
	"database/sql"
	"os"
	"testing"

	"github.com/google/go-cmp/cmp"

	"github.com/tu-hm/code-viz/backend/internal/adapters/mysql"
)

func TestMigrationsGoUpDownAndUpAgain(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	db := emptyDB(t)
	files, err := os.ReadDir("migrations")
	if err != nil {
		t.Fatal(err)
	}

	if err := mysql.Migrate(ctx, db, "up"); err != nil {
		t.Fatal(err)
	}
	up := schema(t, db)

	for range files {
		if err := mysql.Migrate(ctx, db, "down"); err != nil {
			t.Fatal(err)
		}
	}
	if got := schema(t, db); len(got) != 0 {
		t.Fatalf("after down: tables %v, want none", got)
	}

	if err := mysql.Migrate(ctx, db, "up"); err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(up, schema(t, db)); diff != "" {
		t.Errorf("schema after up, down, up (-first up +second up):\n%s", diff)
	}
}

func schema(t *testing.T, db *sql.DB) map[string]string {
	t.Helper()
	rows, err := db.QueryContext(t.Context(),
		"SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> 'goose_db_version'")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		tables = append(tables, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}

	ddl := map[string]string{}
	for _, name := range tables {
		var table, create string
		if err := db.QueryRowContext(t.Context(), "SHOW CREATE TABLE "+name).Scan(&table, &create); err != nil {
			t.Fatal(err)
		}
		ddl[name] = create
	}
	return ddl
}
