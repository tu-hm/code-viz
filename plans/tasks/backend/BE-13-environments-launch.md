# BE-13 · Environments & launch readiness (single machine)

| | |
|---|---|
| **Milestone** | M1 → M5 (spread out) |
| **Estimate** | 14 days |
| **Depends on** | BE-01 §6 (images), BE-02, BE-05, BE-06 |
| **Blocks** | Launch |
| **Covers** | M1-02, M1-11, M1-12, M3-B07, M3-B09, M3-B10, M5-B02, M5-B03 |
| **Spec** | §7.8, §7.9, §13, §18.2, §18.4 |
| **Infra** | One Linux server (Ubuntu/Debian), no cloud, no Kubernetes |

🔁 **Handoffs to FE:** local stack by **Wed 18 Nov** · production by **Mon 28 Dec**.

## 1. Local dev stack (1.5 d · M1 week 4)

Same as before — runs on the developer's Mac/Linux via Docker Compose.

- [ ] Docker Compose: MySQL 8.4 + SeaweedFS (S3 API)
- [ ] Settings from §7.13: InnoDB, `utf8mb4`, UTC, `binlog_format=ROW`, strict mode
- [ ] `vizd --role=all` runs api + worker in one process, with `VIZ_SANDBOX=docker` (BE-02 §2)
- [ ] Runner images built for the host architecture (`make images`), so GDB works on arm64 Macs
- [ ] Create buckets and bucket CORS on start (BE-06 §3)
- [ ] Run migrations on start with `vizd migrate up`
- [ ] Seed data: a few completed Python and C++ traces (`make seed`)
- [ ] **Done:** `make dev` brings up the system from a clean checkout

## 2. Observability (1 d · may slip to M2 week 1)

- [ ] `log/slog` JSON logs with request ID / trace ID
- [ ] OpenTelemetry tracing: API → queue → worker → sandbox, one trace ID end to end
- [ ] Prometheus metrics: request latency, queue depth, claim latency, job duration by stage, failures by kind
- [ ] **Done:** one request traced end to end

## 3. Server provisioning (2 d · M1 week 8)

One Linux server (bare metal or VPS). All services run on this machine.

**OS and prerequisites**
- [ ] Ubuntu 24.04 LTS (or Debian 13); unattended-upgrades for security patches
- [ ] Firewall (ufw): allow 22 (SSH), 80, 443 only
- [ ] Fail2ban for SSH brute-force protection
- [ ] Non-root deploy user (`viz`) with sudo, SSH key auth only (disable password login)
- [ ] Swap file (2–4 GB) as safety net

**MySQL 8.4**
- [ ] Install from the official MySQL APT repo (not distro packages)
- [ ] §7.13 settings: InnoDB, `utf8mb4`, UTC, `binlog_format=ROW`, strict mode
- [ ] Separate database users: `viz_api` (read + write visualizations/usage), `viz_worker` (lease jobs + write traces)
- [ ] Nightly `mysqldump` to a local backup directory, rotated (keep 7 days)
- [ ] Listen on `127.0.0.1:3306` only (not exposed externally)

**SeaweedFS**
- [ ] Install SeaweedFS binary, run as a systemd service (`seaweedfs.service`)
- [ ] `-s3` mode, data dir on a dedicated partition or directory (`/var/lib/seaweedfs`)
- [ ] Listen on `127.0.0.1:8333` only
- [ ] Create the `viz-traces` bucket and set CORS on first deploy

**nsjail**
- [ ] Build nsjail from source (v3.6, pinned commit) or use the binary from the Docker build
- [ ] Install dependencies: `libprotobuf`, `libnl-route-3`
- [ ] Set up cgroups v2: create `/sys/fs/cgroup/viz` subtree for the worker
- [ ] Runner images: unpack rootfs to `/opt/viz/rootfs-python/` (and later `rootfs-cpp/`)

**Done:** a fresh server can be provisioned with a single script (`scripts/provision.sh`)

## 4. Systemd services (1.5 d · M1 week 8)

- [ ] `vizd-api.service`: `vizd --role=api`, runs as `viz` user, `Restart=on-failure`
- [ ] `vizd-worker.service`: `vizd --role=worker`, runs as root (nsjail needs it), `Restart=on-failure`, `KillSignal=SIGTERM`, `TimeoutStopSec=30` (25 s drain + 5 s buffer)
- [ ] Environment files: `/etc/viz/api.env`, `/etc/viz/worker.env` (different DB credentials, S3 keys)
- [ ] `vizd-migrate.service` (oneshot): runs `vizd migrate up` before `vizd-api` starts (`Before=vizd-api.service`)
- [ ] Log to journald; `journalctl -u vizd-api` for viewing
- [ ] **Done:** `systemctl start vizd-api vizd-worker` runs the full system

## 5. Reverse proxy and TLS (1 d · M1 week 9)

- [ ] Caddy (or nginx) as reverse proxy: port 443 → `127.0.0.1:8080` (vizd-api)
- [ ] Automatic TLS via Let's Encrypt (Caddy does this by default)
- [ ] Rate limit: 30 req/min per IP on `POST /visualizations`
- [ ] CORS headers for the frontend origin
- [ ] Static file serving for SeaweedFS chunks (or proxy `GET /chunks/*` to SeaweedFS), so the frontend can fetch trace data
- [ ] `X-Request-ID` header forwarded to vizd
- [ ] **Done:** `https://your-domain.com/healthz` returns 200

## 6. Deploy script and CI/CD (2 d · M1 week 9)

**Deploy script (`scripts/deploy.sh`)**
- [ ] Build `vizd` binary on the server (or cross-compile and `scp`)
- [ ] Run `vizd migrate up`
- [ ] Build runner images on the server (`make runner-images`), unpack rootfs for nsjail
- [ ] Restart `vizd-worker`, then `vizd-api` (worker first so it drains before getting the new binary)
- [ ] Smoke test: `curl -f https://localhost/healthz`

**CI (GitHub Actions)**
- [ ] Run `make check` on every push to `main`
- [ ] On green: SSH into the server, pull `main`, run `scripts/deploy.sh`
- [ ] Rollback: `git checkout <previous-commit> && scripts/deploy.sh`

- [ ] **Done:** push to `main` → tests pass → auto-deploy to the server

## 7. Monitoring and alerts (1.5 d · M3)

- [ ] Prometheus on the server, scraping vizd metrics endpoint
- [ ] Grafana (single instance) for dashboards: request latency, queue depth, job duration, error rate
- [ ] Alertmanager or simple cron script for alerts:
  - Error rate spike
  - Queue wait p95 > 2 s
  - MySQL CPU > 60%
  - Disk usage > 80%
  - vizd process not running
- [ ] Alerts go to email, Slack webhook, or Telegram bot
- [ ] **Done:** alerts fire when vizd is stopped

## 8. Backups and disaster recovery (1 d · M3)

- [ ] MySQL: nightly `mysqldump --single-transaction`, compressed, rotated 7 days
- [ ] SeaweedFS data: nightly rsync or tar of `/var/lib/seaweedfs` to a backup disk or remote (optional)
- [ ] Test restore: documented steps to restore from backup on a fresh server
- [ ] **Done:** restore from backup tested once

## 9. Load test (1.5 d · M3)

- [ ] k6 script: create + long-poll + chunk download, mixed Python/C++
- [ ] Run at expected peak (single machine, so target is more modest than §13 cloud targets)
- [ ] Tune: MySQL pool sizes, worker slots, nsjail concurrency
- [ ] Document the server's capacity ceiling (e.g., "handles N concurrent jobs")
- [ ] **Done:** latency targets met under load

## 10. Launch support (1 d · M3)

- [ ] Buffer for launch-week fixes
- [ ] Runbook for common failures: vizd won't start, MySQL is full, disk full, nsjail errors

## Done when

The server runs vizd (api + worker) behind TLS, auto-deploys from `main`, nightly backups run, and alerts fire on failure.
