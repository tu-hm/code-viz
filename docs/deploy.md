# Deploying

How to run code-viz on one Linux server today, and how the same pieces map to a cloud setup later. The why behind each piece is in the [spec](../plans/code-visualizer-spec_2.md) (§7.9 scaling, §11 limits, §12 security, §13 NFRs, §18.4 infrastructure) and the [backend overview](backend/architecture/overview.md). The work that turns this guide into scripts is [BE-13](../plans/tasks/backend/BE-13-environments-launch.md).

**Status, 24 Oct 2026:** the repo has no production compose file, provision script, deploy script or systemd units yet. The compose file below is a starting point built from the repo's images and settings; it has not been run end to end. Read [Not built yet](#not-built-yet) before you put users on it.

## What runs

```text
internet ──443──> Caddy (TLS) ──> /api/*, /healthz   ──> vizd --role=api     (host network, 127.0.0.1:8080)
                              ──> /viz-traces/* GET  ──> SeaweedFS S3 API    (127.0.0.1:8333)
                              ──> everything else    ──> web/apps/ide/dist   (static files)

vizd --role=worker (privileged, nsjail) ──> MySQL, SeaweedFS
```

| Piece | Runs as | Listens on |
|---|---|---|
| Caddy | Host package, systemd | 0.0.0.0:80, 0.0.0.0:443 |
| `vizd --role=api` | `vizd-api` image, non-root, host network | 127.0.0.1:8080 |
| `vizd --role=worker` | `vizd-worker` image, root, privileged | Nothing outside its container |
| MySQL 8.4 | `mysql:8.4.13` image | 127.0.0.1:3306 |
| SeaweedFS | `chrislusf/seaweedfs:4.48` image, S3 API | 127.0.0.1:8333 |

Why the API uses the host network: vizd trusts `X-Forwarded-For` and `X-Request-ID` only from a loopback peer (§12, `internal/transport/http/boundary.go`). Behind a Docker port mapping the proxy's requests arrive from the bridge gateway, so every caller would hash to one IP and share one daily quota.

Why API and worker are separate containers, not one `--role=all`: the worker must run as root in a privileged container for nsjail ([sandbox](backend/architecture/sandbox.md#the-nsjail-sandbox)). Keeping the API out of it means the internet-facing process is unprivileged. `--role=all` works, but puts both in the privileged container.

## 1. Host requirements

| Need | Check |
|---|---|
| Linux, amd64 or arm64. BE-13 targets Ubuntu 24.04 or Debian 13 | `uname -m` |
| cgroup v2 | `stat -fc %T /sys/fs/cgroup` prints `cgroup2fs` |
| Docker Engine with the Compose v2 plugin, able to run privileged containers (not rootless Docker) | `docker compose version` |
| make, git, curl, jq, the AWS CLI | `make --version`, `aws --version` |
| Node 24 and pnpm 12, only if you build the frontend on this server | `node --version` |
| CPU: about 1 vCPU and 512 MB per worker slot (§7.9), plus 1–2 vCPU for MySQL, SeaweedFS and the API. The beta sizing is 3 slots | `nproc`, `free -g` |
| Disk: Docker images (Python runner about 210 MB, MySQL about 1.1 GB, SeaweedFS about 700 MB, the C++ runner about 1.1 GB once it's enabled), MySQL data, and trace chunks: at most 2 MB gzipped per 1,000-step trace (§13), kept 7 days | `df -h` |

**Build every image on the server.** Runner images must match the CPU architecture: GDB's `ptrace` fails under emulation, and nsjail can't run a foreign binary. If you build elsewhere, compare `docker image inspect --format '{{.Architecture}}' <image>` with `uname -m`.

**Check nsjail works on this host** before anything else. This runs the nsjail sandbox suite in a privileged container, exactly as the worker will:

```sh
git clone https://github.com/tu-hm/code-viz /srv/viz/code-viz
cd /srv/viz/code-viz/backend
make test-nsjail
```

Firewall: allow 22, 80 and 443 only (`ufw allow 22,80,443/tcp`). Docker-published ports skip ufw, so every port below is published on 127.0.0.1 only.

Send container logs to Docker's `local` driver, which rotates them. The default `json-file` driver never does. In `/etc/docker/daemon.json`:

```json
{ "log-driver": "local" }
```

Then `sudo systemctl restart docker`.

## 2. Build the images

From `/srv/viz/code-viz/backend`. Tag vizd with the commit so you can roll back:

```sh
v=$(git rev-parse --short HEAD)
docker build --target api --tag vizd-api:$v .
docker build --target worker --tag vizd-worker:$v .
docker build --file adapters/python/Dockerfile --tag "$(sed -n 's/^image: //p' adapters/python/manifest.yaml)" .
```

The last line is the Python half of `make runner-images`. Skip the C++ runner image while `adapters/cpp/manifest.yaml` says `enabled: false`; its first build compiles GDB and is slow.

## 3. Unpack the runner image for nsjail

nsjail doesn't run Docker images. It chroots into an unpacked copy at `/opt/viz/rootfs/<manifest image>`, which needs empty `/work` and `/proc` directories and empty files to mount the host's devices on ([sandbox](backend/architecture/sandbox.md#the-nsjail-sandbox), `internal/adapters/nsjail/nsjail.go`). The `nsjail-test` stage of `backend/Dockerfile` does the same for its test image.

```sh
img=$(sed -n 's/^image: //p' adapters/python/manifest.yaml)   # viz-runner-python:3.12.15-1
sudo mkdir -p "/opt/viz/rootfs/$img"
cid=$(docker create "$img")
docker export "$cid" | sudo tar -x -C "/opt/viz/rootfs/$img"
docker rm "$cid"
cd "/opt/viz/rootfs/$img" && sudo mkdir -p work proc && sudo touch dev/null dev/zero dev/random dev/urandom
```

Do this again whenever a manifest's `image` changes. Keep the old directory until no worker uses it.

## 4. Configuration

Everything lives in `/srv/viz`, next to the checkout:

```text
/srv/viz/
  code-viz/        the git checkout; vizd reads adapters/*/manifest.yaml from it
  compose.yaml     section 5
  .env             VIZ_VERSION=<commit>, read by docker compose
  mysql.env  migrate.env  api.env  worker.env  s3.json
```

Generate secrets with `openssl rand -hex 24`. Hex keeps `$` and quotes out of env files. `chmod 600` every env file and `s3.json`.

**`mysql.env`**, read by the MySQL image on its first start only:

```sh
MYSQL_DATABASE=viz
MYSQL_USER=viz
MYSQL_PASSWORD=<db password>
MYSQL_ROOT_PASSWORD=<root password>
```

**`s3.json`** turns on SeaweedFS's S3 auth. The dev stack runs with auth off; here the bucket is reachable through the proxy, so it must be on. Each role gets its own key, scoped to the bucket (§12):

```json
{
  "identities": [
    { "name": "admin",  "credentials": [{ "accessKey": "<admin key>",  "secretKey": "<admin secret>" }],  "actions": ["Admin", "Read", "List", "Write"] },
    { "name": "api",    "credentials": [{ "accessKey": "<api key>",    "secretKey": "<api secret>" }],    "actions": ["Read:viz-traces", "Write:viz-traces"] },
    { "name": "worker", "credentials": [{ "accessKey": "<worker key>", "secretKey": "<worker secret>" }], "actions": ["Write:viz-traces"] }
  ]
}
```

The API needs `Write` because the nightly cleanup deletes expired chunks; the worker only puts them.

**`migrate.env`.** `lock_wait_timeout=5` makes a migration stuck behind a long transaction fail after 5 s instead of blocking every reader of the table ([db migrations](backend/guides/db-migrations.md#the-migration-session)):

```sh
VIZ_ENV=prod
VIZ_SANDBOX=nsjail
MYSQL_DSN=viz:<db password>@tcp(127.0.0.1:3306)/viz?lock_wait_timeout=5
```

**`api.env`** (replace `viz.example.com` with your domain):

```sh
VIZ_ENV=prod
VIZ_SANDBOX=nsjail
VIZ_HTTP_ADDR=127.0.0.1:8080
MYSQL_DSN=viz:<db password>@tcp(127.0.0.1:3306)/viz
VIZ_ADAPTERS_DIR=/adapters
S3_ENDPOINT=http://127.0.0.1:8333
S3_PUBLIC_ENDPOINT=https://viz.example.com
S3_BUCKET=viz-traces
S3_PATH_STYLE=true
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<api key>
AWS_SECRET_ACCESS_KEY=<api secret>
CORS_ORIGINS=https://viz.example.com
VIZ_IP_HASH_KEY=<openssl rand -hex 32>
VIZ_SLOTS=1
```

**`worker.env`.** The worker sits on the Compose network, so it reaches MySQL and SeaweedFS by service name:

```sh
VIZ_ENV=prod
VIZ_SANDBOX=nsjail
MYSQL_DSN=viz:<db password>@tcp(mysql:3306)/viz
VIZ_ADAPTERS_DIR=/adapters
S3_ENDPOINT=http://seaweedfs:8333
S3_BUCKET=viz-traces
S3_PATH_STYLE=true
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<worker key>
AWS_SECRET_ACCESS_KEY=<worker secret>
```

What each variable does, from `backend/cmd/vizd/main.go`:

| Variable | Used by | Meaning |
|---|---|---|
| `VIZ_ENV` | all, required | `dev`, `test`, `staging` or `prod`. Outside `dev` and `test`, vizd refuses the Docker sandbox |
| `VIZ_SANDBOX` | all | `nsjail` here. Checked at start under every role, `migrate` included, so the API and migrate env files need it too |
| `VIZ_HTTP_ADDR` | all | Listen address for the API and the probes. Default `:8080` |
| `MYSQL_DSN` | all, required | go-sql-driver DSN. vizd forces UTC, `parseTime` and READ COMMITTED itself |
| `VIZ_ADAPTERS_DIR` | api, worker | Directory of `*/manifest.yaml`. The vizd images don't contain the manifests (`backend/.dockerignore`), so compose mounts `backend/adapters` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_PATH_STYLE` | api, worker | The bucket. `S3_ENDPOINT` empty means AWS S3 |
| `S3_PUBLIC_ENDPOINT` | api | The origin browsers fetch chunks from. URLs are signed for this host |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | api, worker | Read by the AWS SDK's default chain |
| `CORS_ORIGINS` | api | Comma-separated origins allowed to call the API |
| `VIZ_IP_HASH_KEY` | api, required | HMAC key for anonymous callers' IPs, 32 bytes or more. Keep it stable: a new key gives every caller a new identity, with a fresh quota and no delete rights on what they made before |
| `VIZ_SLOTS` | api, required | Worker slots behind this API: one per worker container. `POST` returns `503 capacity` once `VIZ_SLOTS × 10` jobs are queued |

The §11 limits are not env settings: each language manifest sets them.

## 5. Compose file

`/srv/viz/compose.yaml`. The MySQL and SeaweedFS pins are the ones in `backend/compose.yaml`:

```yaml
name: viz

services:
  mysql:
    image: mysql:8.4.13@sha256:76f0358884cb92d9a086d24e5671c38048d3fef40f2588703d73eb55392d6b69
    restart: unless-stopped
    env_file: mysql.env
    ports: ["127.0.0.1:3306:3306"]
    volumes: ["/var/lib/viz/mysql:/var/lib/mysql"]
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "--host=127.0.0.1"]
      interval: 5s
      retries: 60

  seaweedfs:
    image: chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d
    restart: unless-stopped
    command: ["server", "-s3", "-s3.config=/etc/seaweedfs/s3.json", "-dir=/data", "-volume.max=1000"]
    ports: ["127.0.0.1:8333:8333"]
    volumes:
      - /var/lib/viz/seaweedfs:/data
      - ./s3.json:/etc/seaweedfs/s3.json:ro
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8333/healthz"]
      interval: 5s
      retries: 60

  migrate:
    image: vizd-api:${VIZ_VERSION}
    network_mode: host
    env_file: migrate.env
    command: ["migrate", "up"]
    depends_on:
      mysql: { condition: service_healthy }

  api:
    image: vizd-api:${VIZ_VERSION}
    restart: unless-stopped
    network_mode: host
    env_file: api.env
    volumes: ["./code-viz/backend/adapters:/adapters:ro"]
    stop_grace_period: 30s
    depends_on:
      migrate: { condition: service_completed_successfully }
      seaweedfs: { condition: service_healthy }

  worker:
    image: vizd-worker:${VIZ_VERSION}
    restart: unless-stopped
    privileged: true
    cgroup: private
    entrypoint: ["/usr/local/bin/nsjail-cgroups", "/usr/local/bin/vizd"]
    command: ["--role=worker"]
    env_file: worker.env
    volumes:
      - ./code-viz/backend/adapters:/adapters:ro
      - /opt/viz/rootfs:/opt/viz/rootfs:ro
    stop_grace_period: 30s
    deploy: { replicas: 1 }
    depends_on:
      migrate: { condition: service_completed_successfully }
      seaweedfs: { condition: service_healthy }
```

Three settings matter more than they look:

- **`stop_grace_period: 30s`.** On SIGTERM the worker stops claiming and gives its running job 25 s (§13), and the API ends parked long-polls. Docker's default is 10 s, after which it sends SIGKILL and the job is retried from the start.
- **The worker's entrypoint.** `nsjail-cgroups` (`backend/scripts/nsjail-cgroups.sh`) sets up `/sys/fs/cgroup/viz` with the cpu, memory and pids controllers, then runs vizd. `privileged` and `cgroup: private` are what `make test-nsjail` uses.
- **More slots.** One worker container is one slot. To run 3, set `replicas: 3` and `VIZ_SLOTS=3`. Each container has its own cgroup namespace and box directory, so workers don't clean up each other's jails. Each vizd process may open up to 32 MySQL connections (§7.13) against MySQL's default `max_connections` of 151.

## 6. First start

From `/srv/viz`:

1. Point the commit tag at the images you built: `echo "VIZ_VERSION=$v" > .env`.
2. Start storage: `docker compose up -d --wait mysql seaweedfs`.
3. Create the bucket with the admin key. `make seed` can't do this here, because it sends unsigned requests:

   ```sh
   AWS_ACCESS_KEY_ID=<admin key> AWS_SECRET_ACCESS_KEY=<admin secret> AWS_REGION=us-east-1 \
     aws --endpoint-url http://127.0.0.1:8333 s3 mb s3://viz-traces
   ```

   With the web app on the same origin as the bucket, the bucket needs no CORS rule. If you serve the web app from another origin, add one with `aws s3api put-bucket-cors`; the rule `make seed` sets is in `backend/Makefile`.
4. Start the rest: `docker compose up -d`. This runs `vizd migrate up` first, and starts the API and worker only if it succeeds. Check it with `docker compose logs migrate`.

## 7. Frontend

```sh
cd /srv/viz/code-viz/web
pnpm install --frozen-lockfile
VITE_API_BASE_URL=https://viz.example.com/api/v1 pnpm build
sudo mkdir -p /srv/viz/web && sudo rsync -a --delete apps/ide/dist/ /srv/viz/web/
```

The variables are read at build time ([web README](../web/README.md#configuration)). Production builds never include the mock API. The IDE doesn't call the real API yet (FE-04), so for now the page is a placeholder and the API is exercised with curl.

## 8. Reverse proxy and TLS

Install Caddy (`sudo apt install caddy`) and put this in `/etc/caddy/Caddyfile`. Caddy gets and renews the Let's Encrypt certificate itself once DNS points at the server:

```caddyfile
viz.example.com {
	handle /api/* {
		reverse_proxy 127.0.0.1:8080
	}
	handle /healthz {
		reverse_proxy 127.0.0.1:8080
	}

	@chunks {
		path /viz-traces/*
		method GET HEAD
	}
	handle @chunks {
		reverse_proxy 127.0.0.1:8333
	}

	handle {
		root * /srv/viz/web
		try_files {path} /index.html
		encode zstd gzip
		file_server
	}
}
```

Then `sudo systemctl reload caddy`.

- **Chunks pass through unchanged.** A presigned URL's signature covers its host and path. Caddy keeps the `Host` header by default; don't strip or rewrite `/viz-traces`, or every chunk URL fails with 403 (BE-13 §5).
- **No CORS headers in Caddy.** vizd sets them for the API (`CORS_ORIGINS`) and the bucket for chunks; a second set would duplicate them.
- **`X-Forwarded-For`.** Caddy sets it to the client's address, and vizd takes the rightmost hop. `X-Request-ID` passes through; vizd makes one when it's missing.

## 9. Check it works

```sh
curl -fsS http://127.0.0.1:8080/healthz                # 200: the API process is up
curl -fsS http://127.0.0.1:8080/readyz                 # 200: MySQL reachable; 503 while stopping or when MySQL is down
curl -fsS https://viz.example.com/healthz              # 200 through Caddy and TLS
curl -s https://viz.example.com/api/v1/languages       # the enabled languages: python3
```

The worker's probes aren't published. Check it with `docker compose ps` and `docker compose logs worker`. The worker opens nsjail at start, so a host that can't run it shows up as `vizd stopped` in the log and a container that keeps restarting. A runner image missing from `/opt/viz/rootfs` shows up only when a job runs, as an infra error.

Then one visualization end to end, which also proves the signed chunk URL works through Caddy and SeaweedFS auth:

```sh
id=$(curl -s -X POST https://viz.example.com/api/v1/visualizations -H 'Content-Type: application/json' \
  -d '{"language":"python3","source":"x = [1, 2]\nprint(x)\n","stdin":"","options":{"maxSteps":1000,"startAtLines":[]},"context":{"problemCode":null,"client":"curl"}}' | jq -r .id)
curl -s "https://viz.example.com/api/v1/visualizations/$id?wait=20&since=0" | jq '{status, version}'   # repeat with since=<version> until completed
url=$(curl -s "https://viz.example.com/api/v1/visualizations/$id" | jq -r '.trace.chunks[0].url')
curl -s -o /dev/null -w '%{http_code}\n' "$url"
```

The last line prints 200. 403 means the host or path changed between signing and SeaweedFS.

## 10. Logs

vizd writes JSON lines to stdout, one object per event with `level`, `msg` and attributes. It never logs user source, stdin or trace contents.

```sh
docker compose logs -f api worker
docker compose logs --since 1h api | jq -c 'select(.level == "ERROR")'
journalctl -u caddy -f
```

The API logs only 5xx responses, as `request failed` with the `request_id` the caller got in `X-Request-ID`. A broken tracer logs a redacted sample only (§7.8).

## 11. Backups

**MySQL** holds every visualization, quota and job. Dump it nightly and keep 7 days (BE-13 §8):

```sh
sudo mkdir -p /var/backups/viz
cd /srv/viz && docker compose exec -T mysql sh -c 'exec mysqldump --single-transaction -uroot -p"$MYSQL_ROOT_PASSWORD" viz' \
  | gzip > /var/backups/viz/viz-$(date +%F).sql.gz
find /var/backups/viz -name 'viz-*.sql.gz' -mtime +7 -delete
```

Run it from root's crontab; inside crontab, write `%` as `\%`. Copy the dumps off the machine. A nightly dump loses up to a day; §13's RPO of 5 minutes assumes managed MySQL with binlog recovery, which one server doesn't have.

Restore into a running stack:

```sh
gunzip -c /var/backups/viz/viz-<date>.sql.gz \
  | docker compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" viz'
```

**The bucket** is a cache: traces can be rebuilt by running the program again, and §13 gives them no backup. The catch is that a completed trace whose chunks are lost keeps answering for its program and input until it expires (7 days), and its chunk URLs return 404. To avoid that, copy `/var/lib/viz/seaweedfs` while SeaweedFS is stopped (`docker compose stop seaweedfs`, `tar`, `docker compose start seaweedfs`), at a quiet hour: uploads during the gap fail and are retried once.

## 12. Upgrades

Migrations are expand, backfill, contract ([db migrations](backend/guides/db-migrations.md), rule 2): the new schema always works with the old code, so the order is migrate, then roll out.

1. `cd /srv/viz/code-viz && git pull`.
2. Build images with the new commit tag (section 2).
3. If a manifest's `image` changed, build and unpack the new runner image (section 3) before restarting the worker.
4. `cd /srv/viz && echo "VIZ_VERSION=$(git -C code-viz rev-parse --short HEAD)" > .env && docker compose up -d`. Compose runs `migrate` again, then recreates the API and the worker. Each gets SIGTERM: the worker finishes its job within 25 s or requeues it; the API ends parked long-polls, and clients retry.
5. Run the checks in section 9.

The API restart drops new requests for a few seconds; with one API process there is no rolling restart. **Rollback:** set `VIZ_VERSION` back to the previous tag and `docker compose up -d`. Never run `vizd migrate down` on this database (rule 12); the old code already works with the new schema.

## Not built yet

What a real deployment needs and the repo doesn't have yet:

- **Production compose file, `scripts/provision.sh`, `scripts/deploy.sh`, systemd units, CI auto-deploy from `main`** (BE-13 §3, §4, §6). This guide's compose file is untested.
- **nsjail with a real runner image.** `make test-nsjail` covers the adapter with a busybox root; a worker running Python jobs under nsjail on a server hasn't been run. Unpacking runner images onto the host has no script (BE-13 §3).
- **SeaweedFS with S3 auth, behind a proxy.** Dev and the tests run with auth off. Signed chunk URLs through Caddy are designed for (BE-13 §5) but unchecked.
- **The ingress rate limit, 30 creates per minute per IP (§11).** Stock Caddy has no rate limiter; it needs a plugin build or nginx's `limit_req`. Until then only the daily quota in MySQL (100 per IP) applies.
- **Separate MySQL users for the API and the worker** (§12, BE-13 §3). No grants are defined, so both use `viz` here.
- **A sandbox self-check in `/readyz`** (TODO in `cmd/vizd/main.go`). Today `/readyz` checks MySQL only.
- **Metrics, tracing and alerts** (BE-13 §2, §7). There are JSON logs and nothing else; nothing tells you vizd is down.
- **A tested restore** (BE-13 §8).
- **Image registry and cosign signing** (BE-03, BE-07). Images are built on the server.
- **A per-image seccomp allowlist** (BE-02 §5, before GA). The jail uses the C.9 denylist.
- **The IDE calling the API** (FE-04). The deployed frontend is a placeholder.
- **C++** (`enabled: false` in its manifest) and **share links** (BE-12, so no 90-day retention yet).

## Cloud later

The locked target (D15, §18.4) is Kubernetes with a separate runner node pool, KEDA, GitHub Actions and OpenTofu. Whether the M1 beta goes there or stays on VMs is still a Lead decision ([tasks README](../plans/tasks/README.md)). The pieces map like this:

| Piece | One server | Cloud |
|---|---|---|
| MySQL | Container, nightly dump | Managed MySQL 8.4 with HA and binlog point-in-time recovery (RDS or Aurora, Cloud SQL, Azure Flexible Server) for §13's RPO 5 min / RTO 30 min. ProxySQL or RDS Proxy only when §7.9's MySQL trigger fires |
| Object storage | SeaweedFS behind Caddy | S3, R2 or GCS through its S3 API. `S3_ENDPOINT` empty for AWS, `S3_PATH_STYLE` as the provider needs, `S3_PUBLIC_ENDPOINT` empty so URLs are signed for the provider's host. Bucket CORS for the web origin |
| API | One host-network container | A Deployment with `--role=api`, scaled on CPU, behind an ingress with the per-IP limit |
| Worker | Privileged containers on the same box | Privileged pods on a dedicated runner node pool: cgroup v2 nodes of the runner images' architecture, `nsjail-cgroups` as the entrypoint, runner images unpacked on each node. KEDA's MySQL scaler on in-flight jobs (§7.9) |
| Migrations | `migrate` service before the API starts | A Kubernetes Job before each rollout (db migrations guide) |
| Frontend | Caddy `file_server` | Static build on a CDN; the API on its own subdomain, listed in `CORS_ORIGINS` |
| TLS and proxy | Caddy | The ingress or load balancer |

**Stays the same:** one `vizd` binary with the same roles, flags and env vars; the migration rules; nsjail as the sandbox; probes on `/healthz` (liveness) and `/readyz` (readiness); a grace period of at least 30 s for the 25 s drain. Two stateful systems only: no Redis or NATS until a §7.9 trigger fires (D4).

**Has to change first:**

- **Client IPs.** vizd trusts `X-Forwarded-For` only from a loopback peer. Behind an ingress in another pod, every caller would look like the ingress. That needs a code change, or a proxy sidecar in each API pod.
- **`VIZ_SLOTS`** is a fixed number. With autoscaled workers, set it to the pool's maximum slots, or make it follow the pool.
- **Credentials.** The worker's database role and storage key drop to what §12 lists: lease jobs and update its trace, write-only to `t7/`. Workload identity instead of keys in env files.
- **Runner images on nodes**, the worker pod spec and a staging run (BE-13 §3, sandbox doc).
