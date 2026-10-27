# S1b: gVisor vs nsjail for the GDB tracer

**Gate G1 · run Fri 23 Oct 2026 · BE-02 §1 · decided: nsjail (D10), spec v1.5**

## Question

Can the C++ tracer (GDB driving the program through `ptrace`) run inside the production sandbox and still meet S1 (§18.7)? S1 requires that `ptrace` works, a sandbox starts in 300 ms or less, and a 1,000-step trace takes 3 s or less. §7.12 also needs ASLR off, so a trace is the same on every run.

## Setup

- **Host:** ThinkPad X1 Extreme Gen 2 (i7-9850H, 12 threads), Linux 7.0, cgroup v2, Docker 29.9.
- **Box:** Debian trixie with GCC 14.2, GDB 16.3 and Python 3.13. gVisor `runsc` release-20261019.0, the release the worker image pinned before G1. nsjail 3.6 built from source.
- Both sandboxes ran in one privileged Docker container with its own cgroup namespace. This is the "privileged worker pod" shape.
- **Programs:** the BE-08 prototype (`adapters/cpp/trace.py`) on the `loop`, `recursion` and `stl` fixtures, plus a 499-iteration loop that gives 1,003 steps. Each was built with `-g -O0`.
- **gVisor:** an OCI bundle with a read-only root, `/work` bind mounted, `--network=none`, uid 65534, no capabilities, and the 256 MB / 32 PIDs / 1 CPU limits. fd 3 was passed with `--pass-fd 3:3`.
- **nsjail:** the C.9 config with a read-only chroot, `/work` bind mounted, uid 65534, cgroup v2 limits, `persona_addr_no_randomize`, the Kafel denylist and `--pass_fd 3`.

## Results

| | Native | nsjail 3.6 | gVisor, `systrap` (default) | gVisor, `kvm` |
|---|---|---|---|---|
| `ptrace` and GDB stepping work | ✓ | ✓ | ✓ | ✓ |
| Wire output matches native (loop, recursion) | — | ✓ | ✓ | ✓ |
| Start (`/bin/true`, mean of 10) | 2 ms | **4–8 ms** | 50–110 ms | ~60 ms |
| 1,003-step trace (target ≤ 3 s) | 0.65 s | **1.4–1.6 s** | **6.9–9.0 s ✗** | 1.5–2.4 s |
| ASLR off | ✓ | ✓ | **✗** | **✗** |
| `stl` trace is the same on two runs | ✓ | ✓ | **✗** | **✗** |

- **gVisor can't turn ASLR off.** `personality(ADDR_NO_RANDOMIZE)` returns `EINVAL`. GDB's `disable-randomization` therefore does nothing, and heap addresses in the `stl` trace change on every run. That breaks §7.12, and the pointer values the C++ view shows would differ between runs.
- **gVisor's default platform is too slow.** Each GDB step costs many `ptrace` calls, and gVisor emulates them in its user-space kernel. That costs 7–9 ms per step, against 0.65 ms natively. The KVM platform meets the time target, but it needs `/dev/kvm` on every runner node, which means bare metal or nested virtualization. It still can't turn ASLR off.
- **nsjail passes every criterion.** It is about 2× native per step. Removing the CPU limit didn't change that, and the spike didn't look further into why. Its starts take milliseconds.
- **The adapter adds little.** The finished nsjail adapter (`internal/adapters/nsjail`) builds the 1,003-step program with g++ in 0.5 s and traces it in 1.45 s. That includes `viz-shim`, the 32-PID limit and the 256 MB limit.

## Decision

**nsjail (D10)** is the production sandbox. gVisor doesn't pass S1 on the platform it runs on by default. On KVM it is fast enough, but it still can't give deterministic traces, and the node requirements are harder.

The cost: nsjail shares the host kernel. Its isolation is namespaces, cgroups, seccomp and a non-root uid, which is weaker than gVisor's user-space kernel. The mitigations stay as planned: dedicated runner nodes that hold no secrets (§12), the seccomp denylist now and an allowlist before GA (BE-02 §5), and Plan C (D11, Kata VMs around the worker pods) if a security review asks for hardware isolation.

**fd 3 transport:** the nsjail adapter uses `viz-shim` like the Docker adapter does. Both adapters then share one stream decoder and pass the same `sandboxtest`.

## Kubernetes: how a worker pod starts one sandbox per job

- **Shape:** each worker pod runs `vizd --role=worker` and starts nsjail once per command. There is no pod per job and no containerd call from the worker.
- **Privileges:** the worker container runs **privileged** as root, in its own cgroup namespace (the default with cgroup v2). nsjail needs to create user, mount, PID and network namespaces and to write cgroups. With only `CAP_SYS_ADMIN`, the cgroup filesystem stays read-only and nsjail fails. So these pods only run on the dedicated runner node pool.
- **Cgroups:** before vizd starts, `nsjail-cgroups.sh` moves the pod's processes into a child cgroup and turns on the cpu, memory and pids controllers for `/sys/fs/cgroup/viz`. cgroup v2 forbids a cgroup that gives controllers to its children from holding processes itself.
- **Mounts:** none from the host. Each box's `/work` is a 64 MiB tmpfs that the worker mounts under a pod-local directory. Runner images are unpacked into the worker image as read-only root filesystems.
- **Not tested yet:** a real cluster. These numbers come from a privileged Docker container. BE-13 §3 checks the same steps on the staging node pool.

## How to rerun

The adapter's numbers come from `make test-nsjail` (privileged container, `sandboxtest` plus the adapter tests). The gVisor runs used a throwaway image (Debian trixie, `runsc` from `storage.googleapis.com/gvisor/releases/release/20261019.0`, nsjail 3.6). The script timed `gdb -q -nx -batch -x trace.py --args ./main` under each sandbox and compared the wire output with a native run.
