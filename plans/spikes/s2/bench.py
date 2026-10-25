import json
import os
import resource
import statistics
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
COUNTERS = [
    ("settrace", "count"),
    ("monitoring", "count"),
    ("monitoring", "count-nojump"),
    ("monitoring", "count-global"),
    ("settrace", "full"),
    ("monitoring", "full"),
    ("settrace", "full-hybrid"),
]
CASES = [
    ("steps1000", 5000, [("settrace", "full"), ("monitoring", "full"), ("settrace", "full-hybrid")]),
    ("hot_loop", 1000, COUNTERS),
    ("hot_oneline", 1000, COUNTERS),
    ("hot_calls", 1000, COUNTERS),
    ("hot_stdlib", 1000, COUNTERS),
]


def run(hook, mode, program, max_steps):
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    proc = subprocess.run(
        [sys.executable, os.path.join(HERE, f"{hook}_tracer.py"), mode, os.path.join(HERE, "programs", program + ".py"), str(max_steps)],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, pass_fds=(3,), check=True,
    )
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    stats = json.loads(proc.stderr.strip().splitlines()[-1])
    stats["process"] = after.ru_utime + after.ru_stime - before.ru_utime - before.ru_stime
    return stats


def main():
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 9
    null = os.open(os.devnull, os.O_WRONLY)
    if null != 3:
        os.dup2(null, 3)
    print(f"python {sys.version.split()[0]}, {runs} runs per row, exec CPU seconds (time.process_time around exec)")
    print()
    print("| Program | Hook | Mode | Median | Min–max | × untraced | Process CPU | Steps | Line hits |")
    print("|---|---|---|---|---|---|---|---|---|")
    for program, max_steps, configs in CASES:
        configs = [("settrace", "none")] + configs
        cpu = {c: [] for c in configs}
        process = {c: [] for c in configs}
        last = {}
        for _ in range(runs):
            for hook, mode in configs:
                stats = run(hook, mode, program, max_steps)
                cpu[(hook, mode)].append(stats["cpu"])
                process[(hook, mode)].append(stats["process"])
                last[(hook, mode)] = stats
        base = statistics.median(cpu[("settrace", "none")])
        for hook, mode in configs:
            values = cpu[(hook, mode)]
            median = statistics.median(values)
            stats = last[(hook, mode)]
            name = "untraced" if mode == "none" else hook
            ratio = f"{median / base:.1f}" if base >= 0.01 else "—"
            print(f"| `{program}` | {name} | {mode} | {median:.3f} | {min(values):.3f}–{max(values):.3f} | {ratio} | {statistics.median(process[(hook, mode)]):.3f} | {stats['steps']:,} | {stats['hits']:,} |")


if __name__ == "__main__":
    main()
