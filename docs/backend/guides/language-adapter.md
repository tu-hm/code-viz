# Adding or changing a language adapter

An adapter is everything specific to one language: a manifest, a runner image and a tracer (§10). Everything after the tracer is shared: `tracecore`, `vizctl`, the worker and the fixture test. Adding a language changes no Go code. How the pieces fit together is in [tracing](../architecture/tracing.md), and the sandbox the image runs in is in [sandbox](../architecture/sandbox.md). Spec §10.4 is the release checklist (conformance suite, security review, rollout).

## Add a language

1. **Create `backend/adapters/<dir>/`** with a `manifest.yaml`, a `Dockerfile` and the tracer. The C++ prototype lives in `adapters/cpp/`; the Python adapter in `adapters/python/` is the complete example.
2. **Write the manifest** (§10.2). `vizctl` and the worker load every `adapters/*/manifest.yaml` through `internal/adapters/manifest`, which checks them all at once: one bad manifest, or two with the same `id`, fails the load. They read:

   | Field | Meaning |
   |---|---|
   | `id` | The `--lang` and `language.id` value, for example `python3` |
   | `displayName`, `editorMode` | Required. For `GET /languages` (BE-06) |
   | `enabled` | `true` to offer the language. A manifest without it loads as disabled; `vizctl` traces it anyway |
   | `image` | The runner image tag. The adapter's line in `make runner-images` reads it from the manifest |
   | `sourceFile` | The file name in `/work`, for example `main.py` |
   | `build.cmd`, `build.timeoutMs` | The build, or for an interpreted language a check. A non-zero exit is `compile_error`, and its output becomes the diagnostics. Leave out `build` for a language that needs neither |
   | `build.unsupportedModuleExit` | Optional. The exit code that means `unsupported_module` instead |
   | `trace.cmd`, `trace.env` | The tracer command and its environment. The caller adds `VIZ_MAX_STEPS` |
   | `modules.allow` | Optional. Passed to the build as `VIZ_MODULES_ALLOW`, comma-separated |

   Declare `capabilities` honestly; the UI hides what isn't supported (§10.4).
3. **Build a runner image** that meets the requirements below. Add its `docker build` line to the `runner-images` target in `backend/Makefile`, tagged from the manifest's `image`.
4. **Write the tracer** to the wire contract in [tracing](../architecture/tracing.md#the-wire-contract). It writes NDJSON to fd 3: `hello` first, full snapshots, `exit` last with the program's outcome. It reads stdin from `/work/stdin` (fd 0 is `/dev/null`), and it honors `VIZ_MAX_STEPS`: one marker step past the limit, then run to the end untraced (D25). Map the language's types to the §9.5 kinds, and use `opaque` for the rest.
5. **Add fixtures** in `backend/fixtures/<dir>/<case>/`, where `<dir>` is the adapter's directory name: the source file, plus `stdin` if it reads input. Port the shared Python and C++ programs first; the conformance suite needs at least 30 (§10.4).
6. **Run `make golden-update`** and read every new `expected.trace.json` step by step against its source. Then run `make check`.

## Runner image requirements

A runner image works with both sandboxes when:

- **`viz-shim` is at `/opt/viz/viz-shim`,** built static for the image's architecture: `CGO_ENABLED=0 GOOS=linux go build ./cmd/viz-shim`. `adapters/python/Dockerfile` does this in a build stage. The Docker build context is `backend/`; `backend/.dockerignore` excludes `adapters/`, so give the Dockerfile its own `<Dockerfile>.dockerignore`.
- **`tar` and `cat` are on `PATH`.** The adapter uses them to write `Files` and to read `memory.events`.
- **The toolchain runs as UID 65534 with only `/work` writable.** `/tmp` is read-only, so anything that writes temp files needs `TMPDIR=/work` in the command's `Env`. g++ is one of them.
- **It fits in the PID budget.** Go threads count toward the limit. Under Docker, `docker-init` and the idle shim take about 8 of the 32 PIDs, and each running `viz-shim -- …` takes a few more. Under nsjail only the running shim counts. GDB 16 tracing a 1,003-step program and g++ building it both fit.
- **It is built for your machine's architecture.** `make images` builds for the host.
- **It passes the §10.4 security review:** no setuid binaries and no network tools needed at runtime. The Python image removes pip and strips setuid bits.
- **It stays under 1.5 GB.** Pin the base image by digest.

For nsjail, the image is unpacked into a directory on the node (for example with `docker export`, or `COPY --from` in the worker image). That directory also needs:

- **empty `/work` and `/proc` directories, and empty files at `/dev/null`, `/dev/zero`, `/dev/random` and `/dev/urandom`.** The root is read-only, so nsjail can't create its mount points. `docker build` doesn't keep files written to `/dev`, so add them after unpacking.
- **a mount without `nosuid`, `nodev` or `noexec`.** nsjail can't remount such a bind read-only inside a user namespace and fails with EPERM. The image layer of the worker container is fine. A directory under a host `/tmp` that is bind mounted into the container is not.

## Add a fixture

Add `backend/fixtures/<dir>/<case>/` with the source file and an optional `stdin`. Run `make golden-update`, then read the new `expected.trace.json` step by step against the source. The fixture test finds the directory by itself. [Testing](testing.md#golden-traces) lists what each Python fixture pins.

## Change the wire contract

1. Change `backend/schema/wire.v1.schema.json`. Keep it additive and optional when you can; anything stored traces or old tracers can't read is a breaking change (`!` in the commit).
2. Run `make gen`. It regenerates `internal/gen/wire` and the web types.
3. Add accept and reject cases to `schema/wire_test.go`, and an example line to `schema/testdata/wire/`.
4. Update spec §10.1 and the wire contract table in [tracing](../architecture/tracing.md#the-wire-contract).
5. Change the tracers and `tracecore` in the same change, with the schema and the generated code (D14).

## Move the Python tracer to `sys.monitoring` (G2)

Only the hook half of `tracer.py` changes: the event plumbing, the counter after the step limit, and the recursion recovery. Value encoding, output, stdin, `--check` and the wire contract stay as they are.

- **Handle JUMP as well as LINE.** In 3.12, LINE fires only when the line number changes, so a one-line loop would lose its per-iteration steps and line counts. JUMP plus an offset-to-line table from `co_lines()` fixes it.
- **RAISE and PY_UNWIND can't be local events in 3.12.** Set them globally and filter on `co_filename`.
- **Callbacks get no frame.** Take it from `sys._getframe(1)`.
- **Bump `ADAPTER`** from `py-settrace/0.1.0`.

Spike S2 found identical step streams and line hits under both hooks, so the goldens shouldn't move. If one does, find out why before you update it. Details and numbers are in the [S2 report](../../../plans/spikes/s2-python-hook.md).
