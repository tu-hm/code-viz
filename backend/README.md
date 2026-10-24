# Backend

The Go module for `vizd` (API and worker) and `vizctl`. Run every command below from this `backend/` directory.

## Prerequisites

- **Go 1.27.3.** Any recent Go downloads it for you from `go.mod`, unless your Go package sets `GOTOOLCHAIN=local` (Fedora does). Fix that with `go env -w GOTOOLCHAIN=auto`.
- **Docker with the Compose v2 plugin.** Check with `docker compose version`.
  - macOS: Docker Desktop or OrbStack.
  - Linux: Docker Engine and the `docker-compose-plugin` package. Add yourself to the `docker` group with `sudo usermod -aG docker $USER`, then log out and back in.
- **make and git.** On Linux, install them with apt or dnf. You also need gcc, but only for `go test -race`.

`scripts/setup.sh` checks all of these and prints the install command for anything missing.

## First run

```sh
make dev
```

`make dev` does four things:

1. Starts MySQL 8.4 and SeaweedFS (S3 API) with Docker Compose and waits until both are healthy.
2. Runs `vizd migrate up`.
3. Runs `make seed`, which creates the `viz-traces` bucket in SeaweedFS.
4. Starts `vizd --role=all` under [air](https://github.com/air-verse/air), which rebuilds and restarts it when a `.go` or `.sql` file changes.

The first run pulls images and downloads modules, which takes a few minutes. Then check vizd from another terminal:

```sh
curl -i http://127.0.0.1:8080/healthz   # 200: the process is up
curl -i http://127.0.0.1:8080/readyz    # 200: MySQL is reachable; 503 otherwise
```

Press Ctrl-C to stop vizd. `make down` stops the containers and keeps their data. `make reset` also deletes the data.

`--role=all` runs both roles. The API serves `/api/v1` (`api/openapi.yaml`) and queues a job in MySQL for each new visualization; the job worker claims queued jobs, traces them in the Docker dev sandbox and puts the chunks in SeaweedFS. Try it with Python (build the runner image once with `make images`):

```sh
curl -s http://127.0.0.1:8080/api/v1/languages
curl -si -X POST http://127.0.0.1:8080/api/v1/visualizations -H 'Content-Type: application/json' \
  -d '{"language":"python3","source":"x = [1, 2]\nprint(x)\n","stdin":"","options":{"maxSteps":1000,"startAtLines":[]},"context":{"problemCode":null,"client":"curl"}}'
curl -s 'http://127.0.0.1:8080/api/v1/visualizations/<id>?wait=20&since=0'   # repeat with since=<version> until completed
```

Not built yet: the C++ runner image (BE-07, BE-08) and share links (BE-12). `make seed` loads no sample traces until BE-13 §1.

## Trace a program locally

`vizctl trace` runs a language adapter in the Docker dev sandbox, the same way the worker does, and prints the trace as JSON. Build the runner images once with `make images`.

```sh
go run ./cmd/vizctl trace --lang python3 fixtures/python/aliasing/main.py < fixtures/python/aliasing/stdin > trace.json
go run ./cmd/vizctl validate trace.json   # silent when the trace matches schema/trace.v1.schema.json
```

`--lang` is a manifest `id` from `adapters/*/manifest.yaml`. A program that fails its build step (a syntax error, or an import outside `modules.allow`) prints `compile_error` or `unsupported_module` with the diagnostics and exits 1. How the tracer, the wire protocol and the trace core fit together is in the [tracing architecture doc](../docs/backend/architecture/tracing.md).

## Docker dev sandbox

On a laptop, jobs run in Docker containers instead of nsjail, the production sandbox, which doesn't run on macOS. `VIZ_SANDBOX=docker` picks it, and it's the default with `VIZ_ENV=dev`.

**It is not a security boundary.** vizd logs a warning on every start with it, and refuses to start with it unless `VIZ_ENV` is `dev` or `test`, so it never runs in staging or production. Each job still gets its own container with no network, a read-only root, a 64 MB `/work`, 32 PIDs, a memory cap, no capabilities and a non-root user.

- **It needs Docker.** The sandbox talks to the daemon at `DOCKER_HOST`, or `/var/run/docker.sock` if that's unset. That works with vizd on the host and with vizd in Compose with the socket mounted. If your Docker uses a context instead (OrbStack, Colima), export `DOCKER_HOST` as shown under Common problems.
- **It refuses emulated images.** A runner image must match your machine's architecture, because GDB's `ptrace` fails under emulation. Run `make images` once to build them for your machine. Only the Python runner image exists so far; the C++ one comes with BE-07 and BE-08.
- **Leftovers are cleaned up.** Sandbox containers carry `viz.job` and `viz.started` labels. When a sandbox starts, and every minute while the worker runs, it removes boxes started 2 minutes ago or more, longer than any job runs. A dev worker, `vizctl` and the tests can share one Docker daemon.

`make test` runs the sandbox tests against your Docker, with a small busybox test image it builds itself. It also builds the runner images first, because the golden fixture test runs every `fixtures/<language>/<case>/` through `vizctl trace`.

The port contract, `viz-shim` and its frame format and every container setting are in the [sandbox architecture doc](../docs/backend/architecture/sandbox.md). What a runner image needs is in the [language adapter guide](../docs/backend/guides/language-adapter.md#runner-image-requirements). What each test covers and needs is in the [testing guide](../docs/backend/guides/testing.md).

## Ports

Everything listens on 127.0.0.1 only.

| Port | Service |
|---|---|
| 8080 | vizd |
| 13306 | MySQL (user `viz`, password `viz`, database `viz`). Not 3306, so it doesn't clash with a local MySQL. |
| 8333 | SeaweedFS S3 API, with no auth |

## Look at the data

**MySQL.** Connect to `127.0.0.1:13306` as `viz` with password `viz`, database `viz`. GUI clients such as TablePlus or DBeaver fill in port 3306, so change it. Without a local client, use the one in the container:

```sh
docker compose exec mysql mysql -uviz -pviz viz
```

With a local client (`brew install mysql-client`), pass `-h 127.0.0.1`, not `localhost`. With `localhost` the client uses a Unix socket and ignores `-P`:

```sh
mysql -h 127.0.0.1 -P 13306 -uviz -pviz viz
```

**SeaweedFS.** Trace chunks are gzipped JSON files in the `viz-traces` bucket. On OrbStack, the filer has a web file browser at <http://seaweedfs.code-viz.orb.local:8888/buckets/viz-traces/>. Compose doesn't publish port 8888, but OrbStack gives each container a `.orb.local` name. With any Docker, use the AWS CLI against the S3 API. Auth is off, so any keys work, but the CLI needs some to sign with:

```sh
export AWS_ACCESS_KEY_ID=viz AWS_SECRET_ACCESS_KEY=viz AWS_REGION=us-east-1
aws --endpoint-url http://127.0.0.1:8333 s3 ls s3://viz-traces --recursive
aws --endpoint-url http://127.0.0.1:8333 s3 cp s3://viz-traces/<key> - | gunzip
```

Name the bucket: `aws s3 ls` without one prints nothing. A desktop S3 client such as Cyberduck works too: server `127.0.0.1`, port 8333, plain HTTP, path `/viz-traces`.

## Settings

`make` reads `.env.example`, then `.env` if you created one, and exports both to vizd. To change a setting, copy `.env.example` to `.env` and edit the copy. `.env` is git-ignored.

## Commands

| Command | What it does |
|---|---|
| `make dev` | Starts the stack and runs vizd with hot reload |
| `make down` | Stops the containers and keeps their data |
| `make reset` | Stops the containers and deletes their data |
| `make seed` | Creates the trace bucket (`S3_BUCKET`) if it doesn't exist. Sample traces come with BE-13 §1 |
| `make test` | Builds the runner images, then runs `go test ./...`. Needs Docker, because some tests start MySQL with testcontainers, and the sandbox and fixture tests start containers. |
| `make images` | Builds `vizd-api:dev`, `vizd-worker:dev` and the runner images for this machine's architecture |
| `make runner-images` | Builds only the runner images, tagged with each manifest's `image` |
| `make golden-update` | Rewrites the tracecore goldens and every `fixtures/*/*/expected.trace.json` from real runs. Read the diff before committing |
| `go run ./cmd/vizctl trace\|validate` | Traces a program in the Docker dev sandbox, or checks a trace file (see Trace a program locally) |
| `make gen` | Regenerates Go types from `api/` and `schema/`, and the sqlc query code from `internal/adapters/mysql` |
| `make lint` | Runs golangci-lint v2.15.0 with `.golangci.yml`. The first run builds the linter, which takes about a minute |
| `make fmt` | Formats Go code with goimports, then gofmt |
| `make vuln` | Runs govulncheck v1.9.0 |
| `make test-nsjail` | Runs the nsjail sandbox tests in a privileged container. Needs Docker with cgroup v2 that can run privileged containers |
| `make check` | Runs lint, vuln, test and test-nsjail, then fails if `go mod tidy` or `make gen` would change anything. Run it before pushing |
| `scripts/setup.sh` | Checks the prerequisites and prints the install command for anything missing |
| `go run ./cmd/vizd migrate up\|down\|status` | Runs database migrations. Needs `MYSQL_DSN` |

## Common problems

**Docker is not running.** `Cannot connect to the Docker daemon` means Docker isn't running. Start Docker Desktop or OrbStack, or on Linux run `sudo systemctl start docker`. `permission denied ... docker.sock` on Linux means you're not in the `docker` group yet; see Prerequisites.

**A port is already in use.** `make dev` fails with `address already in use` or `port is already allocated`. Find the process with `lsof -nP -iTCP:13306 -sTCP:LISTEN` (on Linux, `ss -ltnp`) and stop it. Or change the host port in `compose.yaml` and the matching value (`MYSQL_DSN` or `VIZ_HTTP_ADDR`) in `.env`.

**Architecture mismatch.** Images you run locally must match your machine: `arm64` on Apple silicon, `amd64` on most Linux PCs. Under emulation GDB's `ptrace` fails, and the Docker sandbox (BE-02) refuses emulated runner images. `make images` builds for your machine. To check an image, compare `docker image inspect --format '{{.Architecture}}' vizd-worker:dev` with `uname -m` (`arm64`/`aarch64` means arm64, `x86_64` means amd64). Don't pass `--platform linux/amd64` for local images on an arm64 Mac. The MySQL and SeaweedFS images are multi-arch, so Docker pulls the native one.

**Tests fail with `rootless Docker not found`, or the sandbox can't reach `/var/run/docker.sock`.** testcontainers and the Docker sandbox ignore Docker contexts, so they can't find OrbStack, Colima or some Docker Desktop setups. Point them at the active context's socket:

```sh
export DOCKER_HOST=$(docker context inspect --format '{{.Endpoints.docker.Host}}')
```

**`Access denied for user 'viz'`.** Check the port first. Port 3306 may belong to another MySQL or MariaDB on your machine, and the `viz` user only exists on 13306. If 13306 refuses it too, the `mysql` volume is older than your change to `MYSQL_USER` or `MYSQL_PASSWORD` in `compose.yaml`. MySQL applies them only when it creates an empty data directory. `make reset` deletes the data so the next `make dev` creates the user again.

**MySQL won't become healthy.** If `docker compose logs mysql` shows a broken data directory, run `make reset` to start from empty volumes.
