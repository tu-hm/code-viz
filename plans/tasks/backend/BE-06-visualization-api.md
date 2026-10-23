# BE-06 · Visualization API

| | |
|---|---|
| **Milestone** | M0 spike (week 3, stretch) → M1 (weeks 4, 8–9) |
| **Estimate** | 7.5 days |
| **Depends on** | BE-01 (OpenAPI), BE-13 §1 (local stack) |
| **Blocks** | FE-04 (IDE integration against real API) |
| **Covers** | M0-14, M1-03, M1-09, M1-10 |
| **Spec** | §7.5, §7.6, §7.12, §7.13, §8, §11 |

## 1. Spike S5 — long-poll capacity (M0-14 · 1.5 d, stretch)

- [ ] Prototype: 5,000 parked long-polls in one pod, woken by a MySQL change poller
- [ ] Measure wake-up latency (target ≤ 400 ms p95) and memory (≤ 200 MB)
- [ ] If skipped: default cap of 5,000 parked requests per pod (§0.2)

## 2. Database (M1-03 · 1.5 d)

- [x] goose migrations (MySQL dialect) for `traces`, `visualizations`, `jobs`, `usage_daily` (§7.5, §7.13.2)
- [x] Types per §7.13.1: `BINARY(32)` cache key, `JSON`, `DATETIME(6)` UTC, `MEDIUMTEXT utf8mb4_bin` for source/stdin
- [x] Indexes: `cache_key` unique, `traces.updated_at`, job `claim_idx` / `lease_idx` / `trace_idx`
- [x] `feature_flags` table (§18.2)
- [x] Session settings: `READ-COMMITTED`, UTC, `parseTime=true`, `loc=UTC`
- [x] sqlc queries (MySQL engine)
- [x] Deadlock retry helper: retry 1213 / 1205 up to 3 times with jitter
- [ ] Respect lock order `usage_daily → traces → visualizations → jobs`
- [x] **Done:** migrations go up and down; queries tested with testcontainers

One migration per table, every table `utf8mb4_bin`, with foreign keys from `visualizations` and `jobs` to `traces`. `traces` has four columns the §7.5 diagram doesn't: `chunks` (JSON: `index`, `fromStep`, `toStep`, `sizeBytes`, `sha256` per chunk, which §8.3 serves and `chunk_count` can't rebuild), `build` (JSON shaped like the API's `Build`), and `failure_stage` and `failure_kind`. Optional strings are `NOT NULL DEFAULT ''`. `claim_idx` orders `priority DESC`: with the spec's ascending key, MySQL sorts, and each claim then locks every queued row (134 of 134 in a test), so a second worker's `SKIP LOCKED` claim finds nothing. sqlc v1.31.1 runs from `make gen` through `go run` and writes `internal/gen/sqlc`, which the drift check in `make check` covers. `mysql.InTx` is the retry helper: 3 tries in all. Lock order: the queue's transactions lock `traces` before `jobs`; the create and delete transactions (§4) still have to follow it.

## 3. Object storage — `BlobStore` (M1-10 · 1.5 d)

- [x] Port + S3 adapter (`aws-sdk-go-v2`): put, with 3 retries (§7.8)
- [ ] Presign GET (15 min), server-side copy
- [ ] Two endpoints: `S3_ENDPOINT` (used by vizd to put/copy) and `S3_PUBLIC_ENDPOINT` (used only to presign). The signature covers the host, so a URL signed for `seaweedfs:8333` can't be rewritten for the browser later
- [x] Path-style addressing option (needed for SeaweedFS locally)
- [x] Keys: `{t7|t90}/{traceId}/chunk-0000.json.gz`
- [x] Upload with `Content-Encoding: gzip`, `Cache-Control: private, max-age=86400, immutable`
- [ ] Bucket CORS: allow `GET` from the IDE origins (`CORS_ORIGINS`), expose `Content-Length`, `ETag`; set up in Compose and OpenTofu
- [ ] Lifecycle rules: `t7/` 7 days, `t90/` 90 days
- [ ] **Done:** the browser downloads a chunk from a presigned URL locally and on staging; objects expire on staging

**Status (24 Oct):** `ports.BlobStore` puts gzipped chunks through `internal/adapters/blobstore` (tested against SeaweedFS), `domain.ChunkKey` builds the keys, and `make seed` creates the dev bucket. Left: presign with `S3_PUBLIC_ENDPOINT`, server-side copy, bucket CORS, lifecycle rules and OpenTofu.

## 4. Endpoints (M1-09 · 3 d)

**`GET /languages`**
- [ ] Built from manifests (`Adapters` port), only `enabled` ones; cache 5 min

**`POST /visualizations`**
- [ ] Validate body and options → `400`; size limits (source 64 KB, stdin 64/256 KB) → `413`
- [ ] Unknown / disabled language → `422`
- [ ] `Idempotency-Key`: return the original response for 24 h
- [ ] One transaction (§7.6): quota upsert on `usage_daily` (100 anon / 1,000 signed in) → `429` with `Retry-After` to next UTC midnight
- [ ] Cache key `sha256(languageId, runtimeVersion, adapterVersion, source, stdin, normalizedOptions)`
- [ ] Single-flight: `INSERT … ON DUPLICATE KEY UPDATE id = id` → affected rows → `SELECT … FOR UPDATE`
- [ ] New trace → enqueue job in the same tx; existing → attach; infra-failed or expired → reset and requeue
- [ ] Insert visualization (`viz_` random 128-bit, `subject` = user ID or IP hash)
- [ ] Max 2 active visualizations per user: a third detaches the oldest queued one
- [ ] Queue cap: queued jobs > `slots × 10` → `503 capacity` + `Retry-After`
- [ ] DB unavailable → `503 capacity`
- [ ] Return `201` + `Location` + same body as GET

**`GET /visualizations/{id}?wait=&since=`**
- [ ] No `wait`: return immediately
- [ ] `wait` (max 20 s): park if not final and `version ≤ since`
- [ ] Change poller (`Events` port): every 250 ms **only while requests are parked**; `updated_at >= last − 1 s`, `LIMIT 500`, dedupe by `(id, version)`, read from primary
- [ ] On timeout, re-read own row (so a failed poller tick only delays, never loses updates)
- [ ] Completed: header + chunk list with fresh presigned URLs + `urlsExpireAt`
- [ ] Failed: `failure` + `build.diagnostics` + `raw`
- [ ] Not found → `404 not_found`; expired → `410 expired`
- [ ] Cap parked requests per pod (from S5)

**`DELETE /visualizations/{id}`**
- [ ] Detach the visualization; cancel the job only if no other visualization waits on the trace → `204`

**Cross-cutting**
- [ ] Error envelope (§8.7) with `requestId` on every error
- [ ] API CORS: allow the IDE origins (`CORS_ORIGINS`), the `Idempotency-Key` header, and expose `Location` and `Retry-After`; handle preflight `OPTIONS`
- [ ] Cache key never leaves the server
- [ ] Nightly batched delete of expired rows (`LIMIT 1000` loops)

## 5. Tests

- [ ] Contract tests for every §8 example (status codes + bodies)
- [ ] Single-flight: concurrent identical POSTs → one trace, one job
- [ ] Quota and idempotency tests
- [ ] Long-poll wake-up latency test (≤ 400 ms)

## Done when

Contract tests pass for every §8 example, and a status change reaches the browser in ≤ 400 ms.
