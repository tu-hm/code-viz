# BE-01 · Foundation & contracts

| | |
|---|---|
| **Milestone** | M0 (week 1) → M1 (week 4) |
| **Estimate** | 7 days |
| **Depends on** | — |
| **Blocks** | Every other BE task; FE codegen (FE-01) |
| **Covers** | M0-01, M0-03, M0-05, M0-06, M1-01, + new: containers & dev workflow |
| **Spec** | §8, §9, §10.1, §18.2, §18.6, §19.9 |

The Go repo, CI, and the three contracts everything else is built on.

🔁 **Handoffs to FE:** `trace.v1.schema.json` by **Wed 28 Oct** · `openapi.yaml` by **Tue 17 Nov**.

## 1. Repo skeleton (M0-01 · 0.5 d)

- [x] Init Go 1.27 module with the §18.6 layout: `cmd/vizd`, `cmd/vizctl`, `internal/{domain,tracecore,app,ports,adapters,transport/http,gen}`
- [x] `vizd` entrypoint with `--role=api|worker|all` flag (roles can be stubs)
- [x] `vizctl` entrypoint with stub subcommands `trace`, `validate`, `diff`
- [x] Config loading with `caarlos0/env`
- [x] Makefile targets: `gen`, `test`, `golden-update`, `images`
- [x] Empty `fixtures/{python,cpp}/` and `schema/`, `api/` folders
- [x] **Done:** `make test` passes

## 2. CI (M0-03 · 1 d)

- [x] GitHub Actions workflow: `golangci-lint`, `go test ./...`, `govulncheck` — one job runs `make check`
- [ ] Add the web checks job (lint/test; FE owns the contents) — added when FE-01 §1 creates the web workspace
- [x] Codegen drift check: run `make gen`, fail if `git diff` is non-empty — part of `make check`
- [ ] Mark all checks as required on PRs to `main` — not set; it would block the direct pushes to `main` this repo uses now
- [ ] **Done:** a PR shows every check — no PR opened yet

## 3. Trace schema — `schema/trace.v1.schema.json` (M0-05 · 2 d)

- [x] Top level (§9.1): `version`, `id`, `language`, `source`, `options`, `summary`, `encoding`, `steps`
- [x] `summary.exit.kind` enum: `normal | exception | signal | timeout | memory_limit | step_limit | output_limit | internal_error`
- [x] `summary.truncation` (`step_limit | time_limit | size_limit`, `atLine`)
- [x] Step (§9.2): `i`, `event`, `prevLine`, `line`, `keyframe`, `stack`, `frames`, `heap`, `removedObjects`, `stdout`, `stderr`, `error`
- [x] Frame (§9.3): `id`, `name`, `kind`, `line`, `locals[]` (with `internal`), `returnValue`
- [x] Values (§9.4): `int float bool char str none ref ptr uninit unavailable`, optional `type`
- [x] Heap kinds (§9.5): `sequence set mapping record function class opaque`
- [x] v1.1 optional fields (§19.9): `sparse` + `patch`, `access[]`, `summary.lineHits` + `lineHitsSource`, `stdinPos`, `summary.untracedTail`, `callId` / `parentCallId`
- [x] Allow unknown fields (forward compatibility, §9.7)
- [x] Valid examples: every fixture; invalid examples: one per required field / bad enum
- [ ] Generate Go structs (`go-jsonschema`) and TS types (`json-schema-to-typescript`) via `make gen` — Go done; the TS step goes into `make gen` with FE-01 §2
- [x] **Done:** validates every fixture; invalid examples rejected in tests

## 4. Wire schema — `schema/wire.v1.schema.json` (M0-06 · 1 d)

- [x] Messages (§10.1): `hello` (`protocol: 1`, `language`, `runtime`, `adapter`), `step` (full snapshot), `out`, `exit`, `log`
- [x] `step.heap` keyed by native IDs (Python `id()`, C++ `address:type`)
- [x] Reuse frame/value/kind definitions from the trace schema (`$ref`)
- [x] Generate Go structs
- [ ] **Done:** validates the S1 prototype output (BE-08 spike) — blocked until the S1 prototype exists; hand-written Python and C++ sessions validate

## 5. OpenAPI — `api/openapi.yaml` (M1-01 · 1.5 d)

- [x] Five endpoints (§8): `GET /languages`, `POST /visualizations`, `GET /visualizations/{id}?wait=&since=`, `DELETE /visualizations/{id}`, `POST /visualizations/{id}/share`
- [x] Request body for create (§8.2) incl. `options` (`maxSteps`, `startAtLines`, `captureRanges`, `showInternals`) and `context`
- [x] `Idempotency-Key` header, `Location` + `Retry-After` response headers
- [x] Response states: tracing (`progress`), completed (`trace.header`, `chunks[]`, `urlsExpireAt`), failed (`failure`, `build.diagnostics`, `raw`)
- [x] Error envelope (§8.7) and every status code from the §8.2 table
- [x] Copy the §8 JSON examples into the spec as `examples` (used by contract tests and FE's MSW mocks)
- [ ] Generate oapi-codegen strict-server stubs + `openapi-typescript` client in `make gen` — server stubs done; the TS client goes into `make gen` with FE-01 §2
- [x] **Done:** server stubs and TS client both generate from it

## 6. Containers & dev workflow (new · 1 d · M1 week 4)

**`vizd` image**
- [ ] One multi-stage `Dockerfile` for `vizd`: Go build stage, then two targets — `viz-shim` missing until BE-02 §2 builds it
  - `api`: distroless/static, non-root, only the `vizd` binary
  - `worker`: `vizd` + the sandbox tooling chosen at G1 (`runsc` or nsjail) + `viz-shim`
- [x] `vizd migrate up|down|status` subcommand (goose embedded), used by `make dev` and the Kubernetes migration Job (BE-13 §3)
- [x] `/healthz` and `/readyz` endpoints on both roles (contents defined in BE-13 §3)

**Multi-arch**
- [ ] Build `vizd` and all runner images for `linux/amd64` and `linux/arm64` with `docker buildx` — `vizd` builds for both; runner images come with BE-03 and BE-08

**Dev workflow**
- [x] Makefile targets: `make dev` (Compose up → migrate → seed → `vizd --role=all` with hot reload), `make down`, `make reset` (drop volumes), `make seed`, `make images` (host architecture only, fast)
- [x] `.env.example` listing every setting (`VIZ_ENV`, `VIZ_SANDBOX`, `MYSQL_DSN`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `CORS_ORIGINS`, limits…), with dev defaults
- [x] Dev README: prerequisites (Go, Docker), first-run steps, common problems (architecture mismatch, Docker not running)

**CI**
- [ ] Run tests that use `testcontainers-go` and the real sandbox on Linux runners — testcontainers tests run in CI; sandbox tests come with BE-02

- [ ] **Done:** a new developer on a Mac or Linux goes from clone to a completed local job with `make dev` and the README only — blocked on BE-02 (sandbox), BE-05 (worker), BE-06 (API, tables) and BE-13 §1 (seed data)

## Done when

FE generates types from the schemas and the API, and CI fails if anything drifts. `make dev` works from a clean checkout.
