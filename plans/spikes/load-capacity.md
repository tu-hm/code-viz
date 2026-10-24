# Load: how much one production server can take

**Run Sat 24 Oct 2026 · ahead of BE-13 §9 (M3-B07) · result: the shared parts carry hundreds of jobs/s; the worker's one slot carries under 1 job/s of mixed traffic; the API's MySQL pool had no limit, fixed in the same change**

## Question

Production is one Linux server (BE-13): MySQL, SeaweedFS, `vizd --role=api`, `vizd --role=worker` and Caddy. Where does it saturate, and at how many jobs per second? §13 asks for 1 job/s at the beta peak, with the time to first step at p50 ≤ 1.5 s / p95 ≤ 4 s for Python and ≤ 3 s / ≤ 7 s for C++.

## Setup

- **Host:** Apple M5 (10 cores, 32 GB), Docker 29.8.2 on OrbStack (10 vCPUs). Another session ran sandbox stress tests on the same machine the whole time (load average 12–25), so throughput is noisy. CPU time per job is the steadier number, and the capacity model below uses it.
- **Code:** commit `26837b8`, plus the pool change for the "after" column.
- **Pipeline benchmark** (`backend/internal/app/load_bench_test.go`): real `Visualizations.Create`, real `app.Worker`s (each with its own pool, as separate processes would have), MySQL 8.4.13 and SeaweedFS 4.48 in testcontainers, the real schema validator and `tracecore`, chunks uploaded to the bucket. Only the sandbox is fake: it replays a Python wire stream with the shape of the `long` fixture (790 B per step, the 1,000-step limit) or a 40-step cut of it. Creates come from 8 goroutines as fast as they go; a run ends when every trace is `completed`. CPU comes from `getrusage` (the Go process) and each container's `cpu.stat`.
- **HTTP load** (`plans/spikes/load/run.sh`): the real `vizd --role=api` binary on MySQL and SeaweedFS in Compose, driven by `loadgen` over loopback with a random `X-Forwarded-For` per request, so each request is a new caller. `VIZ_SLOTS=100000` so the queue cap never refuses. One 1,000-step trace is first completed through the Docker sandbox for the GET phase. Each phase runs 15 s after the TIME_WAIT sockets of the previous one have drained.
- **Sandbox times:** `vizctl trace` in the Docker dev sandbox on this host, plus spike S1b (nsjail, i7-9850H) and S2 for the production sandbox.

## Results

### The shared parts: API, MySQL, SeaweedFS

Pipeline benchmark, CPU per job (job = create, claim, building, tracing, chunk upload, complete):

| Trace | Workers | Jobs/s | Worker ms/job | Go CPU ms/job | MySQL CPU ms/job | SeaweedFS CPU ms/job |
|---|---|---|---|---|---|---|
| 40 steps | 1 | 43 | 23 | 11.4 | 7.1 | 1.2 |
| 40 steps | 8 | 109 | 73 | 11.3 | 5.9 | 1.1 |
| 40 steps | 32 | 227 | 141 | 10.2 | 4.4 | 1.3 |
| 1,000 steps | 1 | 7.1 | 141 | 153 | 16.6 | 5.8 |
| 1,000 steps | 8 | 29.5 | 271 | 167 | 10.4 | 5.2 |
| 1,000 steps | 32 | 22.2 | 1,440 | 164 | 13.4 | 6.5 |

- **MySQL costs 4–17 ms of CPU per job**, 5 commits per job. At 227 jobs/s it used one core. The 1-worker rows are the highest because MySQL's background work is spread over fewer jobs. A create alone is 2.4 ms of MySQL CPU (`BenchmarkCreate`: 774 creates/s at 40 in flight).
- **An idle worker's claim costs 0.17 ms of MySQL CPU** (`BenchmarkClaimEmptyQueue`), so a slot polling 5 times a second costs under 0.1% of a core.
- **SeaweedFS costs about 1.3 ms per chunk** uploaded (one chunk per 250 steps).
- **The worker's own Go code costs 130–165 ms of CPU per 1,000-step trace**, and 10–11 ms per 40-step one. A CPU profile puts about 75% of it in `schema.Validator.Wire`: the JSON Schema check of each wire line (santhosh-tekuri/jsonschema, plus decoding the line into `any`). That is as much as the Python tracer's own work for the same trace (S2: 37 ms of process CPU for 1,086 steps, up to 0.25 s with big lists).
- With 32 workers on 1,000-step traces the machine ran out of CPU (32 × 165 ms of Go per job, plus the other session), so throughput fell below the 8-worker row.

HTTP load on one `vizd --role=api`, 32 clients:

| Phase | Before (no pool limit) | After (pool of 32) |
|---|---|---|
| `POST /visualizations` | 701 req/s; p50 25 ms, p95 139 ms, p99 360 ms, max 1.25 s; **4,145 MySQL connections opened** | 690 req/s; p50 27 ms, p95 158 ms, p99 227 ms, max 0.42 s; 41 connections |
| `GET` of a completed trace (signs 4 chunk URLs) | 2,908 req/s; p95 26 ms, p99 65 ms; **8% `503`**: `dial tcp …:3306: connect: can't assign requested address`; 16,271 connections | **8,448 req/s**; p95 6.9 ms, p99 10 ms; no errors; 10 connections |
| 5,000 long-polls parked on 500 traces, then one version bump | **2,512 `500`** (MySQL refused 2,513 connections at `max_connections` 151), 284 `503` | no `5xx`; 4,201 woken, p50 0.74 s, p95 0.84 s after the bump started; 191 MiB RSS while parked |

- **The pool had no limit, and that was the first thing to break.** `database/sql` opens a connection for every concurrent query and keeps only 2 idle, so under 32 clients vizd opened and closed a MySQL connection every 1–3 requests. That ran the host out of ephemeral ports (`503`), and a burst of parked requests went past MySQL's `max_connections` (`500`). `mysql.Open` now keeps at most 32 connections, all of them idle between uses, and replaces each after 3 minutes, as go-sql-driver advises. A burst now waits for a free connection instead.
- **POST is bound by MySQL here, not by vizd:** 1.0–1.1 ms of vizd CPU per create, and the queue in this test grew without limit, so every create's `COUNT(*)` of queued jobs read up to 10,000 rows. In production the queue cap (`VIZ_SLOTS × 10`) keeps that count small.
- **GET costs 0.45 ms of vizd CPU** with the pool, most of it signing the chunk URLs.
- **Long-polls cost about 40 KB each** (191 MiB with about 4,200 parked). The wake time includes about 0.4 s of `docker compose exec` before the `UPDATE` ran, so the poller's own latency is roughly 0.3–0.4 s. The 799 client errors in the "after" run are connection resets from the listen backlog (`somaxconn` 128 on macOS) when 5,000 connections open in the same instant; real long-polls arrive spread out and through Caddy.

### The worker: sandbox time per job

| Program | Docker dev sandbox, this host | nsjail (S1b, S2, S7) |
|---|---|---|
| Python, 35 steps (`binary-search`) | 0.41–0.65 s | about 0.03–0.1 s of CPU |
| Python, 1,000 steps (`long`) | 0.52–0.64 s | about 0.05–0.3 s of CPU |
| C++, 16 steps (`loop`) | 0.90–1.9 s | build 0.3–0.8 s with the PCH |
| C++, 13 steps with the STL (`stl`) | 1.87–2.09 s | |
| C++, 1,000 steps (`long`) | 1.59–1.64 s (one run 3.8 s) | build 0.5 s + trace 1.45 s |

Most of a short Python job's 0.4 s here is Docker and `vizctl` starting; nsjail starts a box in 4–8 ms (S1b).

## Capacity model for one server

A job runs on one slot: one core, one job at a time. Its CPU is the sandbox plus the worker's Go code; the shared parts add about 30 ms (MySQL 5–17, SeaweedFS 1–6, API 1 ms for the create and 0.45 ms per poll answer). On this host:

| Job | CPU per job | Wall per job (Docker sandbox; less on nsjail for Python) | Jobs/s per slot at 70% |
|---|---|---|---|
| Python, 1,000 steps | about 0.35 s | about 0.5 s | 1.4 |
| C++, 1,000 steps | about 2.1 s | about 2 s | 0.35 |
| Half and half | | about 1.25 s | 0.56 |

**Today one server runs one slot.** `vizd --role=worker` runs a single `app.Worker`, which runs one job at a time, and BE-13 §4 installs one `vizd-worker.service`. So the server carries about 0.35–1.4 jobs/s, and about 0.56 jobs/s for a half-Python, half-C++ mix: **below the 1 job/s beta target** (§13), whatever its core count. A burst past 10 queued jobs (`VIZ_SLOTS=1` × 10) gets `503 capacity`.

With one worker process per core, minus about 1.5 vCPU kept for MySQL, SeaweedFS, the API and Caddy:

| Server | Slots | Mix (1.25 s) | Python only | C++ only |
|---|---|---|---|---|
| 4 vCPU | 2–3 | 1.1–1.7 jobs/s | 2.8–4.2 | 0.7–1.0 |
| 8 vCPU | 6 | 3.4 jobs/s | 8.4 | 2.1 |
| 16 vCPU | 14 | 7.8 jobs/s | 20 | 4.9 |

At those rates MySQL uses under 0.2 of a core and the API less: they have room for roughly 100× more. A slot also needs 512 MB (§7.9), so 6 slots want about 3 GB next to MySQL's buffer pool. These numbers come from an M5; a server core is likely 1.3–2× slower, which scales every row down by as much. If an active student starts one visualization every 2 minutes and nothing hits the cache, 3.4 jobs/s is about 400 students working at once.

Reaching §13's 50 jobs/s needs about 90 slots, so about 15 such 8-vCPU servers (§7.9's multi-node model). The shared MySQL would then use about half a core for the jobs; its first limit is connections (32 per process × processes must stay under `max_connections`), which is §7.9's ProxySQL trigger.

## Findings

1. **Fixed: the MySQL pool had no limit** (above). `mysql.Open` sets 32 open and idle connections and a 3-minute lifetime; `TestOpenPoolsAtMost32ConnectionsAndKeepsThemIdle` fails if either limit goes.
2. **One slot per server.** The capacity above needs several worker processes on the server (a `vizd-worker@N` systemd template, each process with its own random name) or a slot count inside one worker. Not changed here: it changes BE-13 §4.
3. **The wire schema check is the worker's biggest cost** after the sandbox: about 100 ms per 1,000-step trace. A faster check that still validates every message (§12) would free about a quarter of a Python slot. Not changed here.
4. **The poller wakes at most 2,000 changed traces per second per API process** (500 rows per 250 ms tick), and more than 500 rows sharing one microsecond leave the rest to their timeout (known, `poller.go`). One server is far below either.

## How to rerun

From `backend/`, with Docker running:

```bash
go test -run '^$' -bench 'Pipeline|Create|ClaimEmptyQueue' -benchtime=5s ./internal/app   # about 2 minutes
../plans/spikes/load/run.sh 15 /tmp/load    # HTTP phases, about 3 minutes; needs make runner-images
VIZD=/path/to/vizd ../plans/spikes/load/run.sh 15 /tmp/load-other   # compare another build
```

Run them on an idle machine for clean throughput; the CPU-per-job columns hold up on a busy one.
