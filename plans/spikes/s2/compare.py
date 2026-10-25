import difflib
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PROGRAMS = ["calls", "exceptions", "generators", "io_input", "recursion", "threads", "cp_thread", "one_line", "steps1000"]
HOOKS = ["settrace", "monitoring"]


def short(v, heap):
    if v["t"] == "ref":
        return heap[v["id"]]["kind"]
    return v.get("v", v["t"])


def describe(msg):
    if msg["type"] != "step":
        return f"{msg['type']} {msg.get('kind', '')} {msg.get('message', '')}".rstrip()
    top = msg["stack"][-1]
    text = f"{msg['event']:9} {top['name']}:{msg['line']} depth={len(msg['stack'])}"
    if msg["event"] == "return":
        text += f" -> {short(top['returnValue'], msg['heap'])}"
    if msg["error"]:
        text += f" {msg['error']['type']}"
    return text


def trace(hook, program, mode, max_steps):
    stdin_path = os.path.join(HERE, "programs", program + ".txt")
    stdin = ""
    if os.path.exists(stdin_path):
        with open(stdin_path) as f:
            stdin = f.read()
    with tempfile.TemporaryFile("w+") as wire:
        if wire.fileno() != 3:
            os.dup2(wire.fileno(), 3)
        proc = subprocess.run(
            [sys.executable, os.path.join(HERE, f"{hook}_tracer.py"), mode, os.path.join(HERE, "programs", program + ".py"), str(max_steps)],
            input=stdin, capture_output=True, text=True, pass_fds=(3,),
        )
        if wire.fileno() != 3:
            os.close(3)
        wire.seek(0)
        msgs = [json.loads(line) for line in wire]
    stats = json.loads(proc.stderr.strip().splitlines()[-1])
    return msgs, stats, proc.stdout


def main():
    programs = sys.argv[1:] or PROGRAMS
    for program in programs:
        print(f"=== {program}")
        events = {}
        counts = {}
        for hook in HOOKS:
            msgs, stats, stdout = trace(hook, program, "full", 100_000)
            events[hook] = [describe(m) for m in msgs[1:]]
            outside = [m for m in msgs if m["type"] == "step" and m["line"] != m["stack"][-1]["line"]]
            print(f"{hook:10} steps={stats['steps']} hits={stats['hits']} exit={stats['exit']} steps outside main.py={len(outside)} stdout={stdout.strip()!r}")
            _, counted, _ = trace(hook, program, "count", 0)
            counts[hook] = counted["lineHits"]
            if counted["hitsCrc"] != stats["hitsCrc"]:
                print(f"{hook:10} count mode hits differ from full mode: {counted['hits']} vs {stats['hits']}")
        if counts["settrace"] != counts["monitoring"]:
            lines = sorted(set(counts["settrace"]) | set(counts["monitoring"]), key=int)
            print("line hits differ (line: settrace/monitoring):", ", ".join(
                f"{n}: {counts['settrace'].get(n, 0)}/{counts['monitoring'].get(n, 0)}" for n in lines
                if counts["settrace"].get(n) != counts["monitoring"].get(n)))
        diff = list(difflib.unified_diff(events["settrace"], events["monitoring"], "settrace", "monitoring", n=1, lineterm=""))
        if not diff:
            print("same steps:")
            print("\n".join("  " + e for e in events["settrace"][:40]))
            continue
        print("\n".join(diff[:80]))


if __name__ == "__main__":
    main()
