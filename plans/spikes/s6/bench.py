import os
import statistics
import sys
import time

import gdb

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from diff import dirty, dirty_naive  # noqa: E402

STOPS = 1000


def us(xs, q=0.5):
    xs = sorted(xs)
    return "%.1f" % (xs[min(len(xs) - 1, int(q * len(xs)))] * 1e6)


def run(cmd):
    gdb.execute(cmd, to_string=True)


run("set pagination off")
run("set confirm off")
run("set startup-with-shell off")
run("set disable-randomization on")
for line in (10, 11, 12):
    gdb.Breakpoint("main.cpp:%d" % line, internal=True)
run("run")

sym = gdb.lookup_global_symbol("a")
addr = int(sym.value()[0].address)
size = sym.value().type.sizeof
inf = gdb.selected_inferior()
cols = {k: [] for k in ("continue", "read_memory", "tobytes", "fast", "naive")}
changed = []
prev = None
for _ in range(STOPS):
    t0 = time.perf_counter()
    mem = inf.read_memory(addr, size)
    t1 = time.perf_counter()
    raw = mem.tobytes()
    t2 = time.perf_counter()
    if prev is not None:
        fast = dirty(prev, raw, 4)
        t3 = time.perf_counter()
        naive = dirty_naive(prev, raw, 4)
        t4 = time.perf_counter()
        assert fast == naive
        cols["fast"].append(t3 - t2)
        cols["naive"].append(t4 - t3)
        changed.append(len(fast))
    cols["read_memory"].append(t1 - t0)
    cols["tobytes"].append(t2 - t1)
    prev = raw
    t5 = time.perf_counter()
    run("continue")
    cols["continue"].append(time.perf_counter() - t5)

print("array: %d bytes; stops: %d; cells changed per stop: %s" % (
    size, STOPS, dict(sorted(statistics.multimode(changed) and {c: changed.count(c) for c in set(changed)}.items()))))
for k, xs in cols.items():
    print("live %-12s median %8s us  p90 %8s us  max %8s us" % (k, us(xs), us(xs, 0.9), us(xs, 1.0)))

base = bytes(size)
cases = {"0 cells": [], "2 cells": [5, 150000], "196 cells, one per 4 KB block": range(0, size // 4, 1024),
         "every cell": range(size // 4)}
for name, cells in cases.items():
    new = bytearray(base)
    for i in cells:
        new[4 * i] = 1
    new = bytes(new)
    for fn in (dirty, dirty_naive):
        reps = 5 if name == "every cell" else 50
        ts = []
        for _ in range(reps):
            t = time.perf_counter()
            got = fn(base, new, 4)
            ts.append(time.perf_counter() - t)
        assert len(got) == len(cells)
        print("synthetic %-30s %-11s median %8s us" % (name, fn.__name__, us(ts)))
run("kill")
