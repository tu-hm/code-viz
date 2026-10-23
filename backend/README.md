# Backend

The Go module for `vizd` (API and worker) and `vizctl`. Run every command below from this `backend/` directory.

## Prerequisites

- **Go 1.27.3.** Any recent Go downloads it for you from `go.mod`, unless your Go package sets `GOTOOLCHAIN=local` (Fedora does). Fix that with `go env -w GOTOOLCHAIN=auto`.
- **Docker with the Compose v2 plugin.** Check with `docker compose version`.
  - macOS: Docker Desktop or OrbStack.
  - Linux: Docker Engine and the `docker-compose-plugin` package. Add yourself to the `docker` group with `sudo usermod -aG docker $USER`, then log out and back in.
- **make and git.** On Linux, install them with apt or dnf. You also need gcc, but only for `go test -race`.

## First run

```sh
make dev
```

`make dev` does four things:

1. Starts MySQL 8.4 and SeaweedFS (S3 API) with Docker Compose and waits until both are healthy.
2. Runs `vizd migrate up`.
3. Runs `make seed`.
4. Starts `vizd --role=all` under [air](https://github.com/air-verse/air), which rebuilds and restarts it when a `.go` or `.sql` file changes.

The first run pulls images and downloads modules, which takes a few minutes. Then check vizd from another terminal:

```sh
curl -i http://127.0.0.1:8080/healthz   # 200: the process is up
curl -i http://127.0.0.1:8080/readyz    # 200: MySQL is reachable; 503 otherwise
```

Press Ctrl-C to stop vizd. `make down` stops the containers and keeps their data. `make reset` also deletes the data.

Not built yet: the API endpoints (BE-06), the job worker (BE-05) and the sandbox (BE-02). `make seed` loads nothing until BE-13 §1 adds sample traces.

## Ports

Everything listens on 127.0.0.1 only.

| Port | Service |
|---|---|
| 8080 | vizd |
| 13306 | MySQL (user `viz`, password `viz`, database `viz`). Not 3306, so it doesn't clash with a local MySQL. |
| 8333 | SeaweedFS S3 API, with no auth |

## Settings

`make` reads `.env.example`, then `.env` if you created one, and exports both to vizd. To change a setting, copy `.env.example` to `.env` and edit the copy. `.env` is git-ignored. `.env.example` also lists the planned settings, commented out, with the task that adds each one.

## Commands

| Command | What it does |
|---|---|
| `make dev` | Starts the stack and runs vizd with hot reload |
| `make down` | Stops the containers and keeps their data |
| `make reset` | Stops the containers and deletes their data |
| `make seed` | Loads sample data (nothing yet) |
| `make test` | Runs `go test ./...`. Needs Docker, because some tests start MySQL with testcontainers. |
| `make images` | Builds `vizd-api:dev` and `vizd-worker:dev` for this machine's architecture |
| `make gen` | Regenerates Go types from `api/` and `schema/` |
| `go run ./cmd/vizd migrate up\|down\|status` | Runs database migrations. Needs `MYSQL_DSN` |

## Common problems

**Docker is not running.** `Cannot connect to the Docker daemon` means Docker isn't running. Start Docker Desktop or OrbStack, or on Linux run `sudo systemctl start docker`. `permission denied ... docker.sock` on Linux means you're not in the `docker` group yet; see Prerequisites.

**A port is already in use.** `make dev` fails with `address already in use` or `port is already allocated`. Find the process with `lsof -nP -iTCP:13306 -sTCP:LISTEN` (on Linux, `ss -ltnp`) and stop it. Or change the host port in `compose.yaml` and the matching value (`MYSQL_DSN` or `VIZ_HTTP_ADDR`) in `.env`.

**Architecture mismatch.** Images you run locally must match your machine: `arm64` on Apple silicon, `amd64` on most Linux PCs. Under emulation GDB's `ptrace` fails, and the Docker sandbox (BE-02) refuses emulated runner images. `make images` builds for your machine. To check an image, compare `docker image inspect --format '{{.Architecture}}' vizd-worker:dev` with `uname -m` (`arm64`/`aarch64` means arm64, `x86_64` means amd64). Don't pass `--platform linux/amd64` for local images on an arm64 Mac. The MySQL and SeaweedFS images are multi-arch, so Docker pulls the native one.

**Tests fail with `rootless Docker not found`.** testcontainers ignores Docker contexts, so it can't find OrbStack, Colima or some Docker Desktop setups. Point it at the active context's socket:

```sh
export DOCKER_HOST=$(docker context inspect --format '{{.Endpoints.docker.Host}}')
```

**MySQL won't become healthy.** If `docker compose logs mysql` shows a broken data directory, run `make reset` to start from empty volumes.
