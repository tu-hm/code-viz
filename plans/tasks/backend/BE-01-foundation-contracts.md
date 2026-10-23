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

- [ ] Init Go 1.27 module with the §18.6 layout: `cmd/vizd`, `cmd/vizctl`, `internal/{domain,tracecore,app,ports,adapters,transport/http,gen}`
- [ ] `vizd` entrypoint with `--role=api|worker|all` flag (roles can be stubs)
- [ ] `vizctl` entrypoint with stub subcommands `trace`, `validate`, `diff`
- [ ] Config loading with `caarlos0/env`
- [ ] Makefile targets: `gen`, `test`, `golden-update`, `images`
- [ ] Empty `fixtures/{python,cpp}/` and `schema/`, `api/` folders
- [ ] **Done:** `make test` passes

## 2. CI (M0-03 · 1 d)

- [ ] GitHub Actions workflow: `golangci-lint`, `go test ./...`, `govulncheck`
- [ ] Add the web checks job (lint/test; FE owns the contents)
- [ ] Codegen drift check: run `make gen`, fail if `git diff` is non-empty
- [ ] Mark all checks as required on PRs to `main`
- [ ] **Done:** a PR shows every check

## 3. Trace schema — `schema/trace.v1.schema.json` (M0-05 · 2 d)

- [ ] Top level (§9.1): `version`, `id`, `language`, `source`, `options`, `summary`, `encoding`, `steps`
- [ ] `summary.exit.kind` enum: `normal | exception | signal | timeout | memory_limit | step_limit | output_limit | internal_error`
- [ ] `summary.truncation` (`step_limit | time_limit | size_limit`, `atLine`)
- [ ] Step (§9.2): `i`, `event`, `prevLine`, `line`, `keyframe`, `stack`, `frames`, `heap`, `removedObjects`, `stdout`, `stderr`, `error`
- [ ] Frame (§9.3): `id`, `name`, `kind`, `line`, `locals[]` (with `internal`), `returnValue`
- [ ] Values (§9.4): `int float bool char str none ref ptr uninit unavailable`, optional `type`
- [ ] Heap kinds (§9.5): `sequence set mapping record function class opaque`
- [ ] v1.1 optional fields (§19.9): `sparse` + `patch`, `access[]`, `summary.lineHits` + `lineHitsSource`, `stdinPos`, `summary.untracedTail`, `callId` / `parentCallId`
- [ ] Allow unknown fields (forward compatibility, §9.7)
- [ ] Valid examples: every fixture; invalid examples: one per required field / bad enum
- [ ] Generate Go structs (`go-jsonschema`) and TS types (`json-schema-to-typescript`) via `make gen`
- [ ] **Done:** validates every fixture; invalid examples rejected in tests

## 4. Wire schema — `schema/wire.v1.schema.json` (M0-06 · 1 d)

- [ ] Messages (§10.1): `hello` (`protocol: 1`, `language`, `runtime`, `adapter`), `step` (full snapshot), `out`, `exit`, `log`
- [ ] `step.heap` keyed by native IDs (Python `id()`, C++ `address:type`)
- [ ] Reuse frame/value/kind definitions from the trace schema (`$ref`)
- [ ] Generate Go structs
- [ ] **Done:** validates the S1 prototype output (BE-08 spike)

## 5. OpenAPI — `api/openapi.yaml` (M1-01 · 1.5 d)

- [ ] Five endpoints (§8): `GET /languages`, `POST /visualizations`, `GET /visualizations/{id}?wait=&since=`, `DELETE /visualizations/{id}`, `POST /visualizations/{id}/share`
- [ ] Request body for create (§8.2) incl. `options` (`maxSteps`, `startAtLines`, `captureRanges`, `showInternals`) and `context`
- [ ] `Idempotency-Key` header, `Location` + `Retry-After` response headers
- [ ] Response states: tracing (`progress`), completed (`trace.header`, `chunks[]`, `urlsExpireAt`), failed (`failure`, `build.diagnostics`, `raw`)
- [ ] Error envelope (§8.7) and every status code from the §8.2 table
- [ ] Copy the §8 JSON examples into the spec as `examples` (used by contract tests and FE's MSW mocks)
- [ ] Generate oapi-codegen strict-server stubs + `openapi-typescript` client in `make gen`
- [ ] **Done:** server stubs and TS client both generate from it

## 6. Containers & dev workflow (new · 1 d · M1 week 4)

**`vizd` image**
- [ ] One multi-stage `Dockerfile` for `vizd`: Go build stage, then two targets
  - `api`: distroless/static, non-root, only the `vizd` binary
  - `worker`: `vizd` + the sandbox tooling chosen at G1 (`runsc` or nsjail) + `viz-shim`
- [ ] `vizd migrate up|down|status` subcommand (goose embedded), used by `make dev` and the Kubernetes migration Job (BE-13 §3)
- [ ] `/healthz` and `/readyz` endpoints on both roles (contents defined in BE-13 §3)

**Multi-arch**
- [ ] Build `vizd` and all runner images for `linux/amd64` and `linux/arm64` with `docker buildx`
- [ ] Push to the registry with tags by git SHA; deploy by digest
- [ ] Trivy scan + cosign sign in CI for every image

**Dev workflow**
- [ ] Makefile targets: `make dev` (Compose up → migrate → seed → `vizd --role=all` with hot reload), `make down`, `make reset` (drop volumes), `make seed`, `make images` (host architecture only, fast)
- [ ] `.env.example` listing every setting (`VIZ_ENV`, `VIZ_SANDBOX`, `MYSQL_DSN`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `CORS_ORIGINS`, limits…), with dev defaults
- [ ] Dev README: prerequisites (Go, Docker), first-run steps, common problems (architecture mismatch, Docker not running)

**CI**
- [ ] Run tests that use `testcontainers-go` and the real sandbox on Linux runners

- [ ] **Done:** a new developer on a Mac or Linux goes from clone to a completed local job with `make dev` and the README only

## Done when

FE generates types from the schemas and the API, and CI fails if anything drifts. `make dev` works from a clean checkout.
