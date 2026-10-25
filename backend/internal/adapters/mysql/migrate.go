package mysql

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"

	"github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Migrate runs the goose command up, down or status with the embedded migrations.
func Migrate(ctx context.Context, db *sql.DB, command string) error {
	if command != "up" && command != "down" && command != "status" {
		return fmt.Errorf("unknown migrate command %q, want up, down or status", command)
	}

	fsys, err := fs.Sub(migrations, "migrations")
	if err != nil {
		return fmt.Errorf("open migrations: %w", err)
	}
	p, err := goose.NewProvider(goose.DialectMySQL, db, fsys)
	if err != nil {
		return fmt.Errorf("load migrations: %w", err)
	}

	switch command {
	case "up":
		results, err := p.Up(ctx)
		if err != nil {
			return fmt.Errorf("migrate up: %w", err)
		}
		for _, r := range results {
			slog.InfoContext(ctx, "migration applied", "version", r.Source.Version, "file", r.Source.Path, "duration", r.Duration)
		}
		return nil
	case "down":
		r, err := p.Down(ctx)
		if err != nil {
			return fmt.Errorf("migrate down: %w", err)
		}
		slog.InfoContext(ctx, "migration rolled back", "version", r.Source.Version, "file", r.Source.Path, "duration", r.Duration)
		return nil
	}

	statuses, err := p.Status(ctx)
	if err != nil {
		return fmt.Errorf("migrate status: %w", err)
	}
	for _, s := range statuses {
		slog.InfoContext(ctx, "migration", "version", s.Source.Version, "file", s.Source.Path, "state", s.State, "applied_at", s.AppliedAt)
	}
	return nil
}
