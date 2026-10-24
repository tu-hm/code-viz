# Adding or changing a language adapter

An adapter is everything specific to one language: a manifest, a runner image and a tracer (§10). Everything after the tracer is shared: `tracecore`, `vizctl`, the worker and the fixture test. Adding a language changes no Go code. How the pieces fit together is in [tracing](../architecture/tracing.md), and the sandbox the image runs in is in [sandbox](../architecture/sandbox.md). Spec §10.4 is the release checklist (conformance suite, security review, rollout).

## Add a language

1. **Create `backend/adapters/<dir>/`** with a `manifest.yaml`, a `Dockerfile` and the tracer. The Python adapter in `adapters/python/` is the complete example. `adapters/cpp/` is the second: its manifest, its runner image (below) and `trace.py`, the GDB tracer ([inside the C++ tracer](../architecture/tracing.md#inside-the-c-tracer)). The tracer is in, but the manifest stays `enabled: false`: turning C++ on is a separate decision. `vizctl` and the fixture test trace it anyway.
2. **Write the manifest** (§10.2). `vizctl` and the worker load every `adapters/*/manifest.yaml` through `internal/adapters/manifest`, which checks them all at once: one bad manifest, or two with the same `id`, fails the load. They read:

   | Field | Meaning |
   |---|---|
   | `id` | The `--lang` and `language.id` value, for example `python3` |
   | `displayName`, `editorMode` | Required. For `GET /languages` (BE-06) |
   | `enabled` | `true` to offer the language. A manifest without it loads as disabled; `vizctl` traces it anyway |
   | `image` | The runner image tag. The adapter's line in `make runner-images` reads it from the manifest |
   | `sourceFile` | The file name in `/work`, for example `main.py` |
   | `build.cmd`, `build.timeoutMs` | The build, or for an interpreted language a check. A non-zero exit is `compile_error`, and its output becomes the diagnostics. Leave out `build` for a language that needs neither |
   | `build.safetyFlags` | Optional. Appended to `build.cmd` unless the request sets `options.safetyChecks: false` (D21, §19.6). A language without them rejects `false` with `invalid_request` |
   | `build.env` | Optional. Extra environment for the build, for example `TMPDIR: /work` for g++ |
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

## The C++ runner image

`adapters/cpp/Dockerfile` builds `viz-runner-cpp:13.5-gdb14-1` (about 870 MB unpacked) on `debian:bookworm-slim`. Every base image is pinned by digest.

| Piece | Where | Detail |
|---|---|---|
| GCC 13.5.0 | `/usr/local`, copied from the official `gcc` image | `/usr/local/lib64` comes first in the loader path (`/etc/ld.so.conf.d/000-local-lib.conf`). Debian's own `libstdc++` is GCC 12's, too old for what GCC 13 builds |
| GDB 14.2 | `/usr/local/bin/gdb` | Built from source in a stage on the `gcc` image, from the GNU tarball pinned by checksum, with Python and without debuginfod. Bookworm ships GDB 13 |
| Pretty printers | `/usr/local/share/gdb/auto-load/usr/local/lib64/` | libstdc++ installs them next to the library, but GDB's default `auto-load safe-path` refuses `/usr/local/lib64`. Under GDB's data directory they load with `-nx` |
| Precompiled headers | `bits/stdc++.h.gch/checks-off.gch` and `checks-on.gch` | GCC tries every file in a `.gch` directory and uses the first one built with compatible flags. `_GLIBCXX_DEBUG` is defined in one and not the other, so each build matches exactly one |
| `flush_init.cpp`, `trace.py`, `viz-shim` | `/opt/viz/` | `flush_init.cpp` and `trace.py` are copied in the last layer, after the precompiled headers, so editing the tracer doesn't rebuild them |

**The PCH flags must match the manifest's.** The `flags` line in the Dockerfile is `build.cmd` without its files and `-o`; `checks-on.gch` adds `build.safetyFlags`. GCC checks only two things when it picks a PCH: whether debug info is on, and macros the header tests, such as `_GLIBCXX_DEBUG`. A PCH built with another `-O`, `-f…`, `-W…` or `--coverage` is used without a word, so a flag changed on one side only goes unnoticed. After changing either side, check that each build still uses its own PCH: `-H` prints `!` before the PCH GCC used and `x` before one it rejected.

```sh
docker run --rm -i -w /work --tmpfs /work -e TMPDIR=/work viz-runner-cpp:13.5-gdb14-1 \
  sh -c 'cat > main.cpp && g++ -std=gnu++17 -O0 -g3 -fno-omit-frame-pointer --coverage -Wall -Wextra -Wshadow -fdiagnostics-plain-output --param ggc-min-heapsize=32768 --param ggc-min-expand=30 main.cpp /opt/viz/flush_init.cpp -o main -D_GLIBCXX_DEBUG -fsanitize=undefined -fno-sanitize-recover=all -H 2>&1' \
  < main.cpp | grep '^[!x]'
```

GCC uses a PCH only when `#include <bits/stdc++.h>` comes before any code. A `#pragma GCC optimize(…)`, another `#include`, or a macro the headers test (`#define private public`) before it means the build parses the whole header without a PCH. Comments, unrelated macros, and `#define int long long` after the include are fine.

## Add a fixture

Add `backend/fixtures/<dir>/<case>/` with the source file and an optional `stdin`. Run `make golden-update`, then read the new `expected.trace.json` step by step against the source. The fixture test finds the directory by itself. [Testing](testing.md#golden-traces) lists what each fixture pins.

## Change the wire contract

1. Change `backend/schema/wire.v1.schema.json`. Keep it additive and optional when you can; anything stored traces or old tracers can't read is a breaking change (`!` in the commit).
2. Run `make gen`. It regenerates `internal/gen/wire`, the web types and `adapters/wire.py`, then `make typecheck` shows each place a tracer builds a message the new schema refuses.
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
