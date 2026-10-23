# Database Migrations

goose with plain SQL files, MySQL 8.4 dialect (§7.13). `vizd migrate up|down|status` applies them with goose embedded in the binary. Locally that runs as part of `make dev`. On staging and prod it runs as a Kubernetes Job before each rollout (BE-13). sqlc reads the schema from the same files, so `make gen` follows every migration.

## 12 rules

| # | Rule | Why |
|---|---|---|
| 1 | **An applied migration is immutable.** A fix is a new migration. Editing a migration that only exists on your machine is fine. | goose never re-runs a version, so an edit leaves every database that ran the old file silently different from the new one. |
| 2 | **Expand, backfill, contract**, in separate migrations and separate deploys. | The migration Job runs before the rollout, and old and new pods serve side by side during it. The old code must work against the new schema. |
| 3 | **Never rename or retype a live column in place.** Add the new column, write both, switch reads, drop the old one later. | `RENAME COLUMN` is instant, but it breaks every running pod the moment it commits. Most type changes copy the whole table and block writes while they run. |
| 4 | **Name the algorithm on every `ALTER TABLE` of an existing table:** `ALGORITHM=INSTANT`, or `ALGORITHM=INPLACE, LOCK=NONE`. | Without it, MySQL silently falls back to a table copy that blocks writes. With it, MySQL refuses the statement, and you find out in dev instead of in prod. |
| 5 | **One `ALTER TABLE` per table per migration**, with all of its clauses in that one statement. | MySQL commits every DDL statement on its own. A migration of three statements that fails on the third leaves two applied, and goose does not record the version. One statement is atomic. |
| 6 | **ENUMs are append-only, and new values go at the end.** Ship the value first, then the code that writes it. | Appending at the end is instant. Inserting in the middle or reordering rebuilds the table. Removing a value breaks rows that hold it and pods that still write it. |
| 7 | **`MODIFY COLUMN` restates the full column definition**: type, `NULL`/`NOT NULL`, `DEFAULT`, charset and collation. | `MODIFY` replaces the whole definition. Whatever you leave out is dropped, so a missing `DEFAULT` silently becomes no default. |
| 8 | **Columns compared byte for byte use a `_bin` collation**: IDs, keys, `source`, `stdin` (§7.13.1). | The default `utf8mb4_0900_ai_ci` treats `a`, `A` and `á` as equal, in comparisons and in unique keys. |
| 9 | **Foreign keys go in `CREATE TABLE`.** Adding one to a populated table copies the table. | With `foreign_key_checks` on, `ADD FOREIGN KEY` supports only `ALGORITHM=COPY`. |
| 10 | **Seed rows are idempotent**: `INSERT ... AS new ON DUPLICATE KEY UPDATE col = new.col`. Rows every environment needs go in a migration; sample data for local dev goes in `make seed`. | The up/down/up test applies every migration twice. `INSERT IGNORE` also swallows unrelated errors such as truncation. |
| 11 | **Backfills are not migrations.** Update in batches of 1,000 rows (`... LIMIT 1000`, repeated until nothing changes), the same way as the expiry delete (§7.13.1). | One `UPDATE` over a whole table holds its row locks to the end, grows the undo log, and writes one huge row-based binlog event that replicas apply serially. |
| 12 | **`Down` fully reverts `Up`, and is for dev and tests only.** Shared environments roll forward. | Running a down migration on live data destroys the data its up migration created. |

Two more rules from §7.13.4 apply to schema changes: JSON columns (`options`, `header`) are never filtered on, so a needed filter becomes a generated column with its own index. And every table is InnoDB, `utf8mb4`, with times in `DATETIME(6)` UTC.

## The migration session

Every `ALTER TABLE`, even an instant one, briefly takes an exclusive metadata lock on the table. It waits behind any open transaction that has touched the table, and every new query on that table then waits behind the `ALTER`. MySQL's default `lock_wait_timeout` is 31,536,000 seconds (one year). So the migration connection sets it low, through the DSN (`?lock_wait_timeout=5`). A migration stuck behind a long transaction then fails after 5 s and can be re-run, instead of freezing every reader of the table.

Order: **migrate first, then deploy the code that needs the new schema.** Rule 2 is what makes that safe.

## Patterns worth memorising

### Add a column other code will read

```sql
-- +goose Up
ALTER TABLE visualizations ADD COLUMN revoked_at DATETIME(6) NULL, ALGORITHM=INSTANT;

-- +goose Down
ALTER TABLE visualizations DROP COLUMN revoked_at, ALGORITHM=INSTANT;
```

Deploy the code that reads it afterwards. In the reverse order, a pod queries a column that does not exist yet.

### Index a live table

```sql
-- +goose Up
ALTER TABLE visualizations ADD INDEX subject_created_idx (subject, created_at), ALGORITHM=INPLACE, LOCK=NONE;

-- +goose Down
ALTER TABLE visualizations DROP INDEX subject_created_idx, ALGORITHM=INPLACE, LOCK=NONE;
```

Reads and writes continue while the index builds.

### NOT NULL on an existing column

```sql
-- BAD: in one go; fails on the first NULL row, after a full table rebuild
ALTER TABLE traces MODIFY COLUMN exit_kind VARCHAR(32) NOT NULL;
```

Expand, backfill, contract instead:

1. The column already exists and is nullable. Deploy code that always writes it.
2. Backfill the old rows in batches (rule 11), outside the migration.
3. Contract, restating the whole definition (rule 7):

```sql
-- +goose Up
ALTER TABLE traces MODIFY COLUMN exit_kind VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  ALGORITHM=INPLACE, LOCK=NONE;
```

This still rebuilds the table in place. On a large `traces` table, that means copying every row's `source` and `stdin`, and it adds replica lag. Run it when traffic is low.

### Extend an ENUM

```sql
-- +goose Up
ALTER TABLE jobs MODIFY COLUMN status ENUM('queued','running','done','failed','canceled','paused') NOT NULL DEFAULT 'queued',
  ALGORITHM=INSTANT;
```

The new value goes at the end, and the rest of the definition is restated. It is instant while the ENUM has fewer than 256 values.

### Widen a VARCHAR

```sql
-- in place, no copy: utf8mb4 VARCHAR(63) is 252 bytes, still one length byte
ALTER TABLE jobs MODIFY COLUMN leased_by VARCHAR(63) NULL, ALGORITHM=INPLACE, LOCK=NONE;

-- refused with rule 4, a table copy without it: VARCHAR(64) is 256 bytes, two length bytes
ALTER TABLE jobs MODIFY COLUMN leased_by VARCHAR(64) NULL, ALGORITHM=INPLACE, LOCK=NONE;
```

In `utf8mb4` every character can take 4 bytes. Widening in place works only while the column stays on the same side of 255 bytes, which is 63 characters.

## Before you push

1. The migration applies, reverts and re-applies on a MySQL 8.4 container (the up/down/up test).
2. `make gen` ran and the regenerated sqlc code is in the same commit.
3. Every `ALTER TABLE` on an existing table names its algorithm (rule 4).
4. Anything that changes a lock, a retry or a limit also updates §7.13 or §11 (AGENTS.md).

## Version collisions

Two branches can both add a migration with the same sequential version. Or, with timestamp versions, an older-timestamped file can land after a newer one has already been applied. goose refuses both by default. Fix it by renumbering the file that landed later, before any shared environment has applied it. Never renumber a migration that has applied anywhere. That is rule 1 again.

## Shared databases

Never run `INSERT`, `UPDATE`, `DELETE` or DDL by hand against staging or prod without showing the exact SQL and getting confirmation first. Schema changes reach those databases only through the migration Job.
