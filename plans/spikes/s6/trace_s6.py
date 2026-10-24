import os
import sys

import gdb

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
from diff import dirty  # noqa: E402

TRACER = os.environ.get("S6_TRACER", "/opt/viz/trace.py")
MAX_BYTES = 4 << 20

with open(TRACER) as f:
    source = f.read()
setup, start = source.split("gdb.events.stop.connect")
tracer = {"__name__": "trace", "__file__": TRACER}
exec(compile(setup, TRACER, "exec"), tracer)

prev = {}
cells = []
original = tracer["c_array"]


def c_array(key, value, type_name, t, snap, depth):
    obj = original(key, value, type_name, t, snap, depth)
    elem = t.target().strip_typedefs()
    addr = tracer["address"](value)
    if elem.code != gdb.TYPE_CODE_INT or addr is None or t.sizeof > MAX_BYTES:
        return obj
    raw = gdb.selected_inferior().read_memory(addr, t.sizeof).tobytes()
    if addr in prev:
        cells.append(len(dirty(prev[addr], raw, elem.sizeof)))
    prev[addr] = raw
    return obj


tracer["c_array"] = c_array
exec(compile("gdb.events.stop.connect" + start, TRACER, "exec"), tracer)
# trace.py points fds 0-2 at /dev/null once the program runs
with open("s6.txt", "w") as f:
    print("s6: %d array diffs, %d dirty cells" % (len(cells), sum(cells)), file=f)
