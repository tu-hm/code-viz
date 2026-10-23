# BE-02 · Sandbox ⚠

| | |
|---|---|
| **Milestone** | M0 (week 2) → M1 (Docker dev adapter week 4–5, production adapter week 7); attack suite in M3 |
| **Estimate** | 7.5 days |
| **Depends on** | BE-01 (wire schema); M0-09 GDB prototype (see BE-08 §1) |
| **Blocks** | BE-03 `vizctl trace`, BE-05 worker, BE-13 local stack + staging |
| **Covers** | M0-10, M1-07, M3-B08, + new: Docker dev adapter |
| **Spec** | §7.10, §11, §12, §18.3, §18.7 S1, Appendix C.9 |
| **Gate** | **G1 · Fri 6 Nov** — gVisor or nsjail |

Run untrusted code with CPU, memory, time and output limits and no network.

## 1. Spike S1b — measure gVisor vs nsjail (M0-10 · 2 d)

Input: the GDB prototype from M0-09 (loop, recursion, STL programs).

- [x] Run the prototype under **gVisor `runsc`**
- [x] Run it under **nsjail** with the C.9 config sketch
- [x] For each: does `ptrace` work? Sandbox start time (target ≤ 300 ms)? 1,000-step C++ trace time (target ≤ 3 s)?
- [x] Check ASLR is off (`persona_addr_no_randomize` for nsjail)
- [x] Decide how a worker **pod** starts one sandbox per job on Kubernetes (privileged pod calling `runsc`/nsjail, containerd on the node, or one pod per job) and what privileges and mounts that needs
- [x] Write a 1-page report with numbers + recommendation
- [x] Present at **G1**; record the result in spec §0.3

**Result (23 Oct, ahead of G1):** nsjail. gVisor runs GDB but takes 6.9–9.0 s per 1,000 steps on its default platform and can't turn ASLR off; nsjail takes 1.5 s, starts in 4–8 ms and turns ASLR off. Worker pods run privileged on the runner node pool. Report: [plans/spikes/s1b-sandbox.md](../../spikes/s1b-sandbox.md); spec v1.5 records it (D9, D10, Q9).

## 2. `Sandbox` port + Docker dev adapter (new · 1.5 d · M1 week 4–5)

Local dev runs on macOS (arm64), where gVisor and nsjail don't run. This adapter lets `vizd --role=all` and `vizctl trace` run real jobs on any machine with Docker. **It is not a security boundary** and must never run in staging or production.

**Port**
- [x] Define the `Sandbox` port in `internal/ports`: run a build or trace step with limits; return the fd 1/2/3 streams and exit info (exit code, signal, killed-by-limit reason). One box per job runs the build and the trace over a shared `/work`
- [x] Write a shared port test suite (`sandboxtest`) that every adapter must pass: exit codes, timeouts, the three streams, the limits

**fd 3 transport**
- [x] `docker run` can't hand fd 3 to the host, and FIFOs don't cross the Docker Desktop VM boundary. Add a small static Go binary, `viz-shim`, as the runner images' entrypoint. It starts the tracer with pipes on fd 1/2/3 and writes one framed stream (`stream id + length + bytes`) to its own stdout
- [x] The adapter reads that stream over the Docker attach API and splits it back into stdout, stderr and wire messages
- [x] Decide at G1 whether the production adapter uses the shim too (one code path) or passes fd 3 directly

**Adapter: `internal/adapters/dockersandbox`**
- [x] Use the Docker Engine API (Go client) instead of shelling out to `docker`
- [x] Create the container, copy `main.*` and `stdin` in with `CopyToContainer` (no bind mounts, so it works from the host or from inside Compose), start it, attach, wait, remove. `CopyToContainer` can't write to a tmpfs on a read-only root, so the files go in as a tar on the stdin of `tar -x` in the box
- [x] Limits: `--network=none`, `--read-only`, `--tmpfs /work:size=64m`, `--pids-limit 32`, `--memory` = `--memory-swap` (256 MB / 512 MB), `--cpus 1`, `--ulimit stack=256MB`, non-root `--user`
- [x] Hardening: `--cap-drop ALL`, `--security-opt no-new-privileges`
- [x] Seccomp: ship `deploy/dev/seccomp-viz.json` = Docker's default profile **plus** `personality(ADDR_NO_RANDOMIZE)`, so GDB can turn ASLR off and runs stay deterministic (§7.12). Docker's default profile allows `ptrace`, but not this `personality` flag. Lives at `internal/adapters/dockersandbox/seccomp.json` instead, because `go:embed` can't reach outside the package
- [x] Wall-clock watchdog in the adapter: kill the container when the deadline passes
- [x] Labels `viz.job=<id>` and `viz.started=<ts>`; on start, remove leftover `viz.*` containers (dev janitor)
- [x] Image architecture must match the host. Refuse to run an emulated image, because GDB `ptrace` fails under emulation; tell the user to run `make images`
- [x] Map Docker errors (daemon down, image missing) to **infra errors**

**Guardrails and config**
- [x] `VIZ_SANDBOX=docker|runsc|nsjail`; `docker` is the default when `VIZ_ENV=dev`
- [x] `vizd` refuses to start with `VIZ_SANDBOX=docker` unless `VIZ_ENV` is `dev` or `test`, and logs a warning on every start
- [ ] Works with `vizd` on the host (Docker Desktop socket) and with `vizd` inside Compose (mounted `/var/run/docker.sock`)
- [x] Document it in the dev README: needs Docker, run `make images` once for your architecture

**Done:** `vizctl trace --lang python3 main.py` and `vizd --role=all` complete a real job on a Mac, and the port test suite passes against this adapter.

G1 kept `viz-shim` for nsjail too, so both adapters share one stream decoder (`shim.Demux`). The Compose item waits on vizd running in Compose (BE-13 §1); the client reads `DOCKER_HOST` or the default socket, but only the host path is tested. The Done line waits on `vizctl trace` (BE-03, BE-04) and the worker (BE-05); `sandboxtest` already passes against this adapter.

## 3. Production adapter (M1-07 · 2 d)

- [x] Implement the adapter picked at G1 (`internal/adapters/runsc` or `nsjail`) behind the same port; pass `sandboxtest`
- [x] One fresh sandbox per job, destroyed after; no state reused
- [x] Mount the runner image read-only; writable `tmpfs` at `/work` ≤ 64 MB
- [x] No network namespace, no DNS
- [x] Non-root UID, no capabilities
- [x] cgroup limits: CPU, memory (256 MB default / 512 MB ceiling), PIDs ≤ 32
- [x] Stack rlimit 256 MB (counts toward memory)
- [x] Output file-size limit
- [ ] Seccomp policy per image (C.9 denylist to start; allowlist before GA)
- [x] Pass fd 3 (or use `viz-shim`) for the NDJSON wire channel
- [x] Label sandboxes (job ID + start time) so the node janitor can kill orphans (§7.8)
- [x] Map sandbox start failures to an **infra error** (retryable), not a user error

The adapter is `internal/adapters/nsjail`; `make test-nsjail` runs `sandboxtest` and the adapter tests in a privileged container. One box per job is a 64 MiB tmpfs `/work` plus a cgroup; each `Run` is a fresh jail over it. The seccomp item stays open: one C.9 denylist covers every image for now, and the per-image allowlist is due before GA. `SandboxSpec.Image` is the path of an unpacked runner image; BE-05 maps manifests to it.

## 4. Basic containment tests (part of M1-07)

- [x] Fork bomb is stopped by the PID limit
- [x] Network attempt (socket, DNS) fails
- [x] Write outside `/work` fails
- [x] Run against **both** adapters (the Docker one locally, the production one in CI on Linux runners)
- [ ] **Done:** these three run in CI

The three tests are cases in `sandboxtest`, and `make check` now runs the suite against both adapters (`make test-nsjail` for nsjail). Both pass locally; the Done item waits on the first CI run with `test-nsjail`.

## 5. Security test suite (M3-B08 · 2 d)

Every §15 attack case as an automated test, run in CI against the **production** adapter:

- [x] Fork bomb
- [x] Network attempts (TCP, UDP, DNS)
- [x] Writing outside `/work`; filling `/work` past 64 MB
- [x] Huge output (→ `output_limit`)
- [x] 50 MB single-line stdout
- [x] Infinite loop (→ `time_limit`)
- [x] Deep recursion (→ stack / memory limit)
- [x] Memory bomb (→ `memory_limit`)
- [ ] Fake fd-3 messages from Python user code (core must reject or contain)
- [ ] `ptrace` of a process outside the sandbox PID namespace fails
- [ ] Runner image check: no setuid binaries, no network tools (§10.4 item 6)
- [x] A staging/production build with `VIZ_SANDBOX=docker` fails to start

The sandbox-level attacks are cases in `sandboxtest`, run against nsjail by `make check`. Huge output is the failing-writer case: the core's output limit is a writer that returns an error, and the box dies. `TestPickSandbox` in `cmd/vizd` covers the docker refusal. Still open:
- fake fd-3 messages need the Python tracer and the core's wire validation (BE-03, BE-04);
- the `ptrace` item is only partly covered. The suite shows that a host PID can't even be signaled from inside the box, but a real `ptrace` attempt needs a runner image with GDB (BE-07);
- the runner image check needs the runner images (BE-03, BE-07).

## Done when

Fork bombs, network access and filesystem escapes are blocked, and the attack tests run in CI. Local dev runs real jobs through the Docker adapter.
