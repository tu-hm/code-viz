import json
import os

import gdb

LANGUAGE = "cpp17-gcc"
ADAPTER = "cpp-gdb/0.1.0"
SOURCE = "main.cpp"
WIRE_FD = 3
MAX_ITEMS = 100

wire = os.fdopen(WIRE_FD, "w", buffering=1)
os.set_inheritable(WIRE_FD, False)
stops = []


def send(msg):
    wire.write(json.dumps(msg, separators=(",", ":")) + "\n")


def run(cmd):
    gdb.execute(cmd, to_string=True)


def in_source(frame):
    symtab = frame.find_sal().symtab
    return symtab is not None and os.path.basename(symtab.filename) == SOURCE


def text(s):
    if isinstance(s, gdb.LazyString):
        return s.value().string(length=s.length)
    if isinstance(s, gdb.Value) and s.type.strip_typedefs().code == gdb.TYPE_CODE_PTR:
        return s.string()
    return str(s)


def scalar(value):
    code = value.type.strip_typedefs().code
    if code == gdb.TYPE_CODE_BOOL:
        return {"t": "bool", "v": "true" if bool(value) else "false"}
    if code == gdb.TYPE_CODE_CHAR:
        n = int(value)
        return {"t": "char", "v": chr(n % 256), "code": n}
    if code == gdb.TYPE_CODE_INT:
        return {"t": "int", "v": str(int(value))}
    if code == gdb.TYPE_CODE_FLT:
        return {"t": "float", "v": repr(float(value))}
    if code == gdb.TYPE_CODE_ENUM:
        return {"t": "int", "v": str(value)}
    if code == gdb.TYPE_CODE_PTR:
        return {"t": "ptr", "addr": hex(int(value))}
    return None


def encode(value, heap):
    try:
        if value.type.code == gdb.TYPE_CODE_REF:
            out = encode(value.referenced_value(), heap)
        else:
            out = scalar(value) or reference(value, heap)
    except gdb.MemoryError:
        out = {"t": "unavailable", "reason": "unreadable"}
    out["type"] = str(value.type)
    return out


def reference(value, heap):
    printer = gdb.default_visualizer(value)
    hint = printer.display_hint() if hasattr(printer, "display_hint") else None
    if hint == "string":
        return {"t": "str", "v": text(printer.to_string())}
    if value.address is None:
        return {"t": "unavailable", "reason": "no_address"}
    key = "%s:%s" % (hex(int(value.address)), value.type)
    if key not in heap:
        heap[key] = heap_object(value, printer, hint, heap)
    return {"t": "ref", "id": key}


def heap_object(value, printer, hint, heap):
    type_name = str(value.type)
    t = value.type.strip_typedefs()
    if printer is None and t.code == gdb.TYPE_CODE_ARRAY:
        lo, hi = t.range()
        length = hi - lo + 1
        items = [encode(value[i], heap) for i in range(min(length, MAX_ITEMS))]
        return {"kind": "sequence", "type": type_name, "length": length, "items": items, "fixed": True,
                "truncated": length > MAX_ITEMS}
    if printer is None and t.code in (gdb.TYPE_CODE_STRUCT, gdb.TYPE_CODE_UNION):
        fields = [{"name": f.name, "value": encode(value[f], heap)} for f in t.fields()
                  if f.name is not None and not f.is_base_class and not f.artificial]
        return {"kind": "record", "type": type_name, "fields": fields}
    if printer is None or not hasattr(printer, "children"):
        return {"kind": "opaque", "type": type_name, "summary": str(value)}

    children = []
    for _, child in printer.children():
        if len(children) == 2 * MAX_ITEMS:
            break
        children.append(child if isinstance(child, gdb.Value) else gdb.Value(child))
    meta = {"summary": text(printer.to_string())}
    if hint == "map":
        entries = [{"key": encode(children[i], heap), "value": encode(children[i + 1], heap)}
                   for i in range(0, len(children) - 1, 2)]
        return {"kind": "mapping", "type": type_name, "length": len(entries), "entries": entries, "ordered": True,
                "meta": meta}
    items = [encode(c, heap) for c in children[:MAX_ITEMS]]
    return {"kind": "sequence", "type": type_name, "length": len(items), "items": items, "meta": meta}


def local_values(frame, line, heap, scope):
    blocks = []
    block = frame.block()
    while block is not None:
        blocks.append(block)
        if block.function is not None:
            break
        block = block.superblock

    keys = [(b.start, b.end) for b in blocks]
    if scope["line"] is not None and scope["line"] != line:
        for k in scope["live"]:
            scope["ran"][k].add(scope["line"])
    for k in keys:
        if k not in scope["live"]:
            scope["ran"][k] = set()
    scope["line"], scope["live"] = line, keys

    out = []
    for block, k in reversed(list(zip(blocks, keys))):
        for sym in block:
            if not (sym.is_variable or sym.is_argument) or (not sym.is_argument and sym.line > line):
                continue
            if not sym.is_argument and sym.line == line and line not in scope["ran"][k]:
                value = {"t": "uninit", "type": str(sym.type)}
            else:
                value = encode(sym.value(frame), heap)
            local = {"name": sym.name, "value": value}
            if sym.name.startswith("__"):
                local["internal"] = True
            out.append(local)
    return out


def global_symbols():
    symtab = gdb.lookup_global_symbol("main").symtab
    syms = [s for block in (symtab.global_block(), symtab.static_block()) for s in block
            if s.is_variable and s.symtab is not None and os.path.basename(s.symtab.filename) == SOURCE]
    return sorted(syms, key=lambda s: s.line)


def user_frames():
    frames = []
    frame = gdb.newest_frame()
    while frame is not None:
        if in_source(frame):
            frames.append(frame)
        frame = frame.older()
    frames.reverse()
    return frames


def step_message(event, prev_line, frames, ids, scopes, globals_):
    heap = {}
    line = frames[-1].find_sal().line
    stack = []
    if globals_:
        stack.append({"id": "globals", "name": "Globals", "kind": "global", "line": line,
                      "locals": [{"name": s.name, "value": encode(s.value(), heap)} for s in globals_],
                      "returnValue": None})
    for frame, call_id in zip(frames, ids):
        frame_line = frame.find_sal().line
        stack.append({"id": str(call_id), "name": frame.name(), "kind": "function", "line": frame_line,
                      "locals": local_values(frame, frame_line, heap, scopes[call_id]), "returnValue": None})
    msg = {"type": "step", "event": event, "line": line, "prevLine": prev_line, "stack": stack, "heap": heap,
           "error": None}
    if event == "call":
        msg["callId"] = ids[-1]
        if len(ids) > 1:
            msg["parentCallId"] = ids[-2]
    return msg


def trace():
    for cmd in ("set pagination off", "set confirm off", "set suppress-cli-notifications on",
                "set print inferior-events off", "set print thread-events off", "set startup-with-shell off",
                "set disable-randomization on"):
        run(cmd)
    # gdb 17 matches main.cpp against any `skip -gfi` glob, so skip by function name
    run("skip -rfu ^(std|__gnu_cxx)::")
    # step reports a breakpoint hit on entry; tells apart calls that reuse one stack slot
    run("rbreak %s:." % SOURCE)

    producer = (gdb.lookup_global_symbol("main").symtab.producer or "").split()
    runtime = "GCC " + producer[2] if len(producer) > 2 and producer[0] == "GNU" else "unknown"
    send({"type": "hello", "protocol": 1, "language": LANGUAGE, "runtime": runtime, "adapter": ADAPTER})

    globals_ = global_symbols()
    run("run")
    null = os.open(os.devnull, os.O_WRONLY)
    os.dup2(null, 1)
    os.dup2(null, 2)
    os.close(null)

    prev_frames, prev_ids, prev_line = [], [], None
    next_id = 1
    scopes = {}
    while True:
        stop = stops[-1]
        stops.clear()
        if isinstance(stop, gdb.ExitedEvent):
            code = stop.exit_code if hasattr(stop, "exit_code") else None
            return {"type": "exit", "kind": "normal", "code": code, "signal": None, "message": None}
        if isinstance(stop, gdb.SignalEvent):
            return {"type": "exit", "kind": "signal", "code": None, "signal": stop.stop_signal, "message": None}

        frames = user_frames()
        if not frames:
            run("continue")
            continue
        newest = gdb.newest_frame()
        if not in_source(newest):
            run("finish")
            continue
        sal = newest.find_sal()
        # step can stop in a gap between gcc's line ranges; gdb then reports the next line with sal.pc == 0
        if sal.pc != 0 and newest.pc() != sal.pc:
            run("step")
            continue

        entered = isinstance(stop, gdb.BreakpointEvent)
        ids = []
        for i, frame in enumerate(frames):
            new_call = entered and i == len(frames) - 1
            if not new_call and i < len(prev_frames) and prev_frames[i] == frame and ids == prev_ids[:i]:
                ids.append(prev_ids[i])
            else:
                ids.append(next_id)
                scopes[next_id] = {"line": None, "live": [], "ran": {}}
                next_id += 1
        msg = step_message("call" if entered else "line", prev_line, frames, ids, scopes, globals_)
        send(msg)
        prev_frames, prev_ids, prev_line = frames, ids, msg["line"]
        run("step")


gdb.events.stop.connect(stops.append)
gdb.events.exited.connect(stops.append)
try:
    send(trace())
except Exception as e:
    send({"type": "log", "level": "error", "message": "%s: %s" % (type(e).__name__, str(e)[:200])})
    send({"type": "exit", "kind": "internal_error", "code": None, "signal": None, "message": None})
