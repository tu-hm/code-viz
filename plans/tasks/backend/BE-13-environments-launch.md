# BE-13 · Environments & launch readiness

| | |
|---|---|
| **Milestone** | M1 → M5 (spread out) |
| **Estimate** | 19.5 days |
| **Depends on** | BE-01 §6 (images), BE-02, BE-05, BE-06 |
| **Blocks** | Launch |
| **Covers** | M1-02, M1-11, M1-12, M3-B07, M3-B09, M3-B10, M5-B02, M5-B03 |
| **Spec** | §7.8, §7.9, §13, §18.2, §18.4 |

🔁 **Handoffs to FE:** local stack by **Wed 18 Nov** · staging by **Mon 28 Dec**.

## 1. Local dev stack (M1-02 · 1.5 d · M1 week 4)

- [ ] Docker Compose: MySQL 8.4 + SeaweedFS (S3 API)
- [ ] Settings from §7.13: InnoDB, `utf8mb4`, UTC, `binlog_format=ROW`, strict mode
- [ ] `vizd --role=all` runs api + worker in one process, with `VIZ_SANDBOX=docker` (BE-02 §2)
- [ ] Runner images built for the host architecture (`make images`), so GDB works on arm64 Macs
- [ ] Create buckets and bucket CORS on start (BE-06 §3)
- [ ] Run migrations on start with `vizd migrate up` (the same command production uses, §3)
- [ ] Separate MySQL users and S3 keys for api and worker, with the §12 permissions, so permission bugs show up locally
- [ ] Change poller and KEDA-style queries go to the primary, as in production
- [ ] Seed data: a few completed Python and C++ traces (chunks in SeaweedFS + rows in MySQL), so FE can work against the local stack without running jobs (`make seed`)
- [ ] Note in the dev README: SeaweedFS only partly supports S3 lifecycle rules, so expiry is tested on staging, not locally
- [ ] **Done:** `make dev` brings up the system from a clean checkout

## 2. Observability (M1-11 · 1 d · may slip to M2 week 1)

- [ ] `log/slog` JSON logs with request ID / trace ID
- [ ] OpenTelemetry tracing: API → queue → worker → sandbox, one trace ID end to end
- [ ] Prometheus metrics: request latency, queue depth, **claim latency**, job duration by stage, failures by kind, parked long-polls, poller query time
- [ ] **Done:** one request traced end to end

## 3. Staging (M1-12 · 4.5 d · M1 week 9)

**Decide first (Lead + BE, before M1 week 9)**
- [ ] One deploy path for the M1 beta: Kubernetes staging (recommended), **not** the "2–3 VMs with systemd + Docker + runsc" option in §18.4. Update §18.4 and add a change-log row (§0.3)

**Infrastructure (OpenTofu)**
- [ ] Kubernetes cluster, managed MySQL 8.4, bucket with lifecycle rules (`t7/` 7 d, `t90/` 90 d) and CORS
- [ ] Dedicated runner node pool, set up the way G1 decided (BE-02 §1): gVisor or nsjail installed, the pod privileges and mounts it needs, no secrets on these nodes except the worker's scoped ones
- [ ] Get runner images onto runner nodes: pre-pull them (DaemonSet), or unpack the rootfs to `/opt/viz/rootfs-*` for nsjail; pin by digest
- [ ] Ingress with TLS and the per-IP rate limit (30/min on create)

**Kubernetes manifests (`deploy/k8s`, Kustomize or Helm)**
- [ ] Base + overlays for `staging` and `prod`; config per environment from env vars (`.env.example`, BE-01 §6)
- [ ] Deployments for `api` and `worker`, using the `vizd` images from BE-01 §6
- [ ] Probes: `/healthz` (process alive) and `/readyz` (api: MySQL reachable; worker: MySQL reachable + sandbox self-check). `/readyz` fails as soon as `SIGTERM` arrives, so traffic stops before the 25 s drain
- [ ] `terminationGracePeriodSeconds` > 25 s; `PodDisruptionBudget` for api
- [ ] Migrations run as a Kubernetes `Job` (`vizd migrate up`) before each rollout; migrations must be backward compatible (expand, then contract) so old and new pods can run side by side
- [ ] KEDA MySQL scaler on in-flight jobs (§7.9 query), 1 job per slot
- [ ] HPA on CPU for API pods; cluster autoscaler for runner nodes

**Secrets and credentials (§12)**
- [ ] Pick the delivery method: cloud identity (IRSA / Workload Identity) for S3, and External Secrets (or Kubernetes Secrets) for MySQL passwords
- [ ] Worker DB role can lease jobs + update its trace only; worker storage key write-only to `t7/`; API key read/sign/copy; KEDA gets a read-only DB user
- [ ] No secrets in images, manifests or CI logs

**CI/CD**
- [ ] CI builds, scans and signs images, then deploys `main` to staging (migration Job → rollout)
- [ ] Rollback is one command (previous image digest)

- [ ] **Done:** autoscales from 1 to 3 runner pods; a rolling deploy with jobs running fails none of them

## 4. Load test (M3-B07 · 3 d)

- [ ] k6 script: create + long-poll + chunk download, mixed Python/C++
- [ ] Run at 2× expected peak
- [ ] Check §13 latency targets (Python ≤ 1.5 s / 4 s, C++ ≤ 3 s / 7 s time to first step)
- [ ] Check queue wait, MySQL CPU, autoscaling response
- [ ] Tune DB pool sizes, worker slots, KEDA thresholds
- [ ] **Done:** §13 targets met under load

## 5. Production, alerts, runbooks (M3-B09 · 3 d)

- [ ] Production environment via OpenTofu (same as staging, sized per §7.9)
- [ ] Alerts: error rate, queue wait p95 > 2 s, MySQL CPU > 60%, job failure spike, abuse (IP burns daily quota in minutes)
- [ ] Runbook for each §7.8 failure case
- [ ] Rolling deploy check: workers drain in 25 s, no failed jobs
- [ ] Backup/PITR verified (RPO ≤ 5 min, RTO ≤ 30 min)
- [ ] **Done:** on-call can follow the runbook for the §7.8 cases

## 6. Launch support (M3-B10 · 1.5 d)

- [ ] Buffer for launch-week fixes

## 7. Post-launch (M5-B02, M5-B03 · 5 d)

- [ ] Cost and performance tuning from production metrics (§7.9 triggers)
- [ ] Support the usability-test environment (§19.11)

## Done when

Staging autoscales, §13 latency targets pass under load, and on-call has runbooks.
