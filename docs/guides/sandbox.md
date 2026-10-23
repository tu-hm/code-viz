# Sandbox

Every job runs the user's program in a sandbox (§12). The worker talks to it through the `Sandbox` port in `backend/internal/ports/sandbox.go`. Today there is one adapter, the Docker dev sandbox in `internal/adapters/dockersandbox`. The production adapter (gVisor `runsc` or nsjail) is decided at gate G1 on Fri 6 Nov and built in BE-02 §3. Every adapter has to pass the shared suite in `internal/ports/sandboxtest`.

Read this before you wire the worker to the sandbox (BE-05), build a runner image or tracer (BE-03, BE-07, BE-08), or write the production adapter.

## The port: one box per job

A C++ job compiles `main.cpp` and then runs GDB on the binary it built, so both steps need the same `/work`. §12 also asks for one fresh sandbox per job, with nothing reused. So `Start` creates a **box** for one job, `Run` runs one command in it, and `Close` destroys it. `/work` survives between `Run` calls and disappears at `Close`.

```go
box, err := sb.Start(ctx, ports.SandboxSpec{
	JobID:  jobID,
	Image:  manifest.Image,
	Files:  map[string][]byte{"main.cpp": source, "stdin": stdin},
	Memory: 256 << 20,
})
if err != nil {
	return fmt.Errorf("start sandbox: %w", err)
}
defer func() { err = errors.Join(err, box.Close(context.WithoutCancel(ctx))) }()

buildCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
defer cancel()
build, err := box.Run(buildCtx, ports.Command{Args: buildCmd, Stdout: &diag, Stderr: &diag, Wire: io.Discard})
// ...
trace, err := box.Run(traceCtx, ports.Command{Args: traceCmd, Env: traceEnv, Stdout: stdout, Stderr: stderr, Wire: wire})
```

This is a sketch; the real flow belongs to BE-05. `Files` are written into `/work` before the first `Run`. `Memory` caps memory plus swap, so there is no swap.

### What `Run` returns

| What happened | `Run` returns | The box afterwards |
|---|---|---|
| The program exited with code n | `Exit{Code: n}`, nil | Usable |
| A signal killed it | `Exit{Signal: s}`, nil | Usable |
| It went over `Memory` | `Exit{Signal: 9, Limit: LimitMemory}`, nil | Usable |
| `ctx`'s deadline passed | `Exit{Limit: LimitTime}`, nil | Dead |
| `ctx` was canceled | `ctx.Err()` | Dead |
| One of the writers returned an error | That error, wrapped | Dead |
| The shim's stream was broken or forged | A plain error | Dead |
| Docker failed (daemon down, image missing or built for another architecture, create or exec failed) | An error wrapping `domain.ErrInfra` | — |

Turning these into `exit.kind` and `truncation` is the worker's job (§7.7). Only `domain.ErrInfra` is retried, once. A broken stream is a plain error on purpose, so it ends as `internal_error` instead of a retry: the user's program can corrupt its own stream (see below).

### Rules for callers

- **Pass all three writers.** They are called from one goroutine, in the order the sandbox read the data, so one writer can serve two streams (`&diag` above).
- **Enforce the core's limits through the writers.** Output, step and trace-size limits (§11) are counted outside the sandbox. When one is hit, return an error from the writer. `Run` kills the box and returns that error.
- **Enforce wall time with the context deadline.** The adapter's watchdog kills the box when the deadline passes. Use the deadline, not a timer of your own.
- **Close with a context that isn't canceled.** The job's context may already be done when you clean up.
- **One `Run` at a time.** Never `Run` again on a dead box. In the Docker adapter that fails with `ErrInfra`, which would requeue a job that should have ended.
- **Stdin is a file.** The program's fd 0 is `/dev/null`. Put the input in `Files` as `stdin`; the tracers read `/work/stdin` themselves (§7.11).

## viz-shim and the frame stream

The tracer writes the wire protocol to fd 3 (§10.1), but `docker run` can't hand fd 3 to the host, and FIFOs don't cross the Docker Desktop VM. So the adapter runs every command through `viz-shim` (`backend/cmd/viz-shim`), a small static Go binary in the runner image. It has two modes:

- `viz-shim` with no arguments waits for SIGTERM. The Docker adapter uses it as the container's main process.
- `viz-shim -- cmd args...` starts `cmd` with stdin on `/dev/null` and pipes on fd 1, 2 and 3. It writes everything it reads as frames to its own stdout. When `cmd` exits, it kills `cmd`'s process group, waits for every pipe to reach EOF, and then writes one exit frame.

Each frame is one byte of stream id, then the payload length as a 4-byte big-endian integer, then the payload:

| Stream id | Payload |
|---|---|
| 1 | stdout bytes |
| 2 | stderr bytes |
| 3 | fd 3 bytes (wire NDJSON) |
| 4 | Exit: the code, then the signal, each a big-endian uint32. Always the last frame. |

A payload is at most 64 KiB. The codec is `backend/internal/shim`.

**The stream is hostile.** The user's program runs as the same UID as the shim, so it can ptrace the shim and write anything to its stdout. `shim.Reader` reads into one fixed 64 KiB buffer. It rejects unknown stream ids, oversize lengths, a cut-off stream and exit values out of range, and it is fuzzed (`FuzzReader`). Wire messages inside stream 3 still go through the schema check in the core, like any other sandbox output (§12).

A background process that calls `setsid` escapes the process-group kill and keeps the pipes open. The shim then never writes its exit frame, and the run ends at the deadline with `LimitTime`.

## The Docker dev sandbox

**It is not a security boundary.** It exists because gVisor and nsjail don't run on macOS. vizd enforces that:

| `VIZ_ENV` | `VIZ_SANDBOX` unset | `VIZ_SANDBOX=docker` | `runsc` or `nsjail` |
|---|---|---|---|
| `dev` | docker | allowed, with a warning on every start | allowed |
| `test` | refused | allowed, with a warning on every start | allowed |
| `staging`, `prod` | refused | refused | allowed |

`VIZ_ENV` is required and must be one of the four values. For now vizd only checks these settings; the worker (BE-05) will open the sandbox.

### Container settings

One container per box:

| Setting | Value | Why |
|---|---|---|
| Network | `none` | No network, no DNS (§12) |
| Root filesystem | read-only | Only `/work` is writable |
| `/work` | tmpfs, 64 MiB, `exec`, mode 1777 | §12. `exec` because the C++ build runs `./main` from it. Mode 1777 because Docker creates the mount point as root 0755 |
| User | `65534:65534` | Non-root |
| Capabilities | all dropped, plus `no-new-privileges` | §12 |
| Seccomp | Docker's default profile plus `personality(ADDR_NO_RANDOMIZE)` | GDB turns ASLR off so runs are deterministic (§7.12) |
| PIDs | 32 | Stops fork bombs (§11) |
| Memory | `SandboxSpec.Memory`, with swap equal to it | 256 MB default, 512 MB ceiling (§11) |
| CPU | 1 | §7.9 sizing: one slot is one vCPU |
| Stack rlimit | 256 MiB | §11 |
| Init | `docker-init` as PID 1 | Reaps orphans, which would otherwise hold PIDs |
| Labels | `viz.job=<id>`, `viz.started=<RFC 3339 UTC>` | Lets the janitor find leftovers |

`Start` runs `docker-init` with `viz-shim` in its idle mode, then writes `Files` into `/work`. Each `Run` is a `docker exec` of `/opt/viz/viz-shim -- args...`. The adapter splits Docker's attach stream, decodes the frames into your three writers, and keeps up to 4 KiB of the shim's own stderr for error messages. A kill is `docker kill` of the whole container, so a box that hit a limit is dead.

### Two Docker quirks

- **Files go in through `tar`, not `CopyToContainer`.** `CopyToContainer` can't write into a tmpfs on a read-only root: with a `--mount` tmpfs it reports success but the file lands under the mount and the container never sees it, and with `--tmpfs` the daemon refuses. So `Start` streams a tar archive into `tar -x -f - -C /work`, run in the box as the sandbox user.
- **Out-of-memory kills come from `memory.events`.** Docker's `OOMKilled` flag lands a few milliseconds after the exec ends, so checking it right away misses about 40% of kills. When a command ends with SIGKILL, the adapter runs `cat /sys/fs/cgroup/memory.events` in the box. It reports `LimitMemory` only if `oom_kill` went up since the box's last run, so a program that sends itself SIGKILL is not reported as a memory kill.

### Seccomp profile

`internal/adapters/dockersandbox/seccomp.json` is the default profile from `moby/profiles/seccomp` v0.1.0 (the version Docker 29 vendors), embedded with `go:embed`. It has one addition: the `personality` rule that allows `0x40000` (`ADDR_NO_RANDOMIZE`). Without it the call fails with EPERM, and GDB prints "Error disabling address space randomization: Operation not permitted" and runs with ASLR on. To move to a newer Docker profile, replace the file and add that rule again. The `aslr can be turned off` test fails if the rule is missing.

### Architecture check and janitor

- `Start` refuses an image whose architecture doesn't match the daemon's: GDB's `ptrace` fails under emulation. The error says to run `make images`.
- `dockersandbox.New` force-removes every container labelled `viz.job`, left over from a crash. It removes them all, whoever started them, so two processes that each call `New` against one Docker daemon delete each other's boxes. Don't run a dev worker and the dockersandbox tests at the same time.

## Runner image requirements

A runner image (BE-03, BE-07, BE-08) works with the Docker sandbox when:

- **`viz-shim` is at `/opt/viz/viz-shim`,** built static for the image's architecture: `CGO_ENABLED=0 GOOS=linux go build ./cmd/viz-shim`. The `build` stage of `backend/Dockerfile` already builds it, for the worker image.
- **`tar` and `cat` are on `PATH`.** The adapter uses them to write `Files` and to read `memory.events`.
- **The toolchain runs as UID 65534 with only `/work` writable.** `/tmp` is read-only, so anything that writes temp files needs `TMPDIR=/work` in the command's `Env`. g++ is one of them.
- **It fits in the PID budget.** `docker-init` and the idle shim take about 8 of the 32 PIDs, and each running `viz-shim -- …` takes about 6 more, because Go threads count toward the limit. That leaves about 18 for the tracer and the user's program. Recent GDB versions can start worker threads, so check a traced C++ program against this budget early.
- **It is built for your machine's architecture.** `make images` builds for the host.

## Tests

| Run | What it covers |
|---|---|
| `go test ./internal/adapters/dockersandbox/` | The shared suite against the Docker adapter, plus adapter-only cases: missing image, emulated image, unreachable daemon, the janitor, `Close`. About 6 s once images are cached |
| `go test ./internal/shim -fuzz=FuzzReader -fuzztime=30s` | Fuzzes the frame reader. Commit any failing input it finds (test 9) |
| `go test ./cmd/vizd` | The `VIZ_ENV` and `VIZ_SANDBOX` rules |

The dockersandbox tests build `viz-sandboxtest:dev` themselves: busybox (pinned by digest) plus a `viz-shim` compiled for the daemon's architecture. On OrbStack or Colima, export `DOCKER_HOST` first (see the backend README, Common problems).

`sandboxtest.Run(t, sandbox, image)` is the contract every adapter passes. It covers exit codes and signals, the three streams (including a 5 MB single-line write), files and `/work` surviving between runs, deadline and cancel, a failing writer, the memory limit, the PID limit, network, read-only paths, the size of `/work`, non-root without capabilities, the stack rlimit, and turning ASLR off. To add a case, add a table entry whose `name` states the behavior and give it one or more steps. Each case gets its own box and runs in parallel.

## Not built yet

| What | Where |
|---|---|
| Production adapter (`runsc` or nsjail), passing `sandboxtest` | BE-02 §3, after G1 |
| Whether the production adapter uses `viz-shim` or passes fd 3 directly | G1 |
| Security suite (§15 attacks) against the production adapter | BE-02 §5, M3 |
| The worker opening the sandbox and running jobs | BE-05 |
| A sandbox self-check in `/readyz` | BE-13 §3 |
| `vizd` in Compose with the Docker socket mounted, tested | BE-13 §1 |
