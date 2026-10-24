# Seed fixtures through the job queue, not with SQL

Decided 2026-10-24.

**Decision:** `vizd seed` loads each golden under `backend/fixtures/` with `MetaStore.Create`, then `JobQueue.Claim` and `Complete`, the path a real job takes, with the trace as the golden. There is no seed-only query.

**Why:** a seeded row then has what a real one has (version, expiry, chunks, build, `storage_prefix`), and stays that way when a migration adds a column. Create's idempotency key (the fixture name, subject `seed`) makes a repeat within 24 h a no-op, so `make dev` can seed on every start. The job is signed in, so it is claimed before any anonymous job left in the queue; a running worker can still take it, so seeding stops with an error instead of guessing.

**How to apply:** keep seeding on the ports. If C++ or another disabled language must not be seeded, filter in `cmd/vizd/seed.go`, not by adding SQL.
