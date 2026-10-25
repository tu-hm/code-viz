import io
import itertools
import json
import sys
import time
import types
import zlib

MAIN = "main.py"
MAX_ITEMS = 1000
MAX_STR = 1000
MAX_FRAMES = 100

hits = []
steps = 0
max_steps = 1000
prev_line = None
out = None
stdin = None


class Out:
    def __init__(self, raw):
        self.raw = raw

    def write(self, s):
        return self.raw.write(s)

    def flush(self):
        self.raw.flush()


def value(v, heap):
    t = type(v)
    if t is bool:
        return {"t": "bool", "v": "true" if v else "false"}
    if t is int:
        return {"t": "int", "v": str(v)}
    if t is float:
        return {"t": "float", "v": repr(v)}
    if t is str:
        if len(v) > MAX_STR:
            return {"t": "str", "v": v[:MAX_STR], "truncated": True, "len": len(v)}
        return {"t": "str", "v": v}
    if v is None:
        return {"t": "none"}
    key = str(id(v))
    if key not in heap:
        heap[key] = None
        heap[key] = heap_object(v, heap)
    return {"t": "ref", "id": key}


def heap_object(v, heap):
    t = type(v)
    if t is list or t is tuple:
        return {
            "kind": "sequence",
            "type": t.__name__,
            "length": len(v),
            "items": [value(x, heap) for x in v[:MAX_ITEMS]],
            "fixed": t is tuple,
        }
    if t is dict:
        return {
            "kind": "mapping",
            "type": "dict",
            "length": len(v),
            "entries": [{"key": value(k, heap), "value": value(x, heap)} for k, x in itertools.islice(v.items(), MAX_ITEMS)],
        }
    if t is set or t is frozenset:
        return {"kind": "set", "type": t.__name__, "length": len(v), "items": [value(x, heap) for x in itertools.islice(v, MAX_ITEMS)]}
    if t is types.FunctionType:
        return {"kind": "function", "name": v.__qualname__}
    if t is type:
        return {"kind": "class", "name": v.__name__}
    if t.__module__ == "__main__":
        return {"kind": "record", "type": t.__name__, "fields": [{"name": k, "value": value(x, heap)} for k, x in vars(v).items()]}
    return {"kind": "opaque", "type": t.__name__, "summary": repr(v)[:200]}


def frames(frame, heap):
    chain = []
    f = frame
    while f is not None and len(chain) < MAX_FRAMES:
        if f.f_code.co_filename == MAIN:
            chain.append(f)
        f = f.f_back
    chain.reverse()
    stack = []
    for f in chain:
        local = []
        for name, v in f.f_locals.items():
            if name.startswith("__") or type(v) is types.ModuleType:
                continue
            local.append({"name": name, "value": value(v, heap)})
        is_module = f.f_code.co_name == "<module>"
        stack.append({
            "id": str(id(f)),
            "name": f.f_code.co_name,
            "kind": "global" if is_module else "function",
            "line": f.f_lineno,
            "locals": local,
            "returnValue": None,
        })
    return stack


def emit(event, frame, call_id, ret=None, error=None):
    global steps, prev_line
    heap = {}
    stack = frames(frame, heap)
    if event == "return":
        stack[-1]["returnValue"] = value(ret, heap)
    line = frame.f_lineno
    msg = {
        "type": "step",
        "event": event,
        "line": line,
        "prevLine": prev_line,
        "stack": stack,
        "heap": heap,
        "error": error,
        "callId": call_id,
        "stdinPos": {"bytes": stdin.tell()},
    }
    out.write(json.dumps(msg, separators=(",", ":")) + "\n")
    prev_line = line
    steps += 1


def error(exc, frame):
    return {"type": type(exc).__name__, "message": str(exc), "line": frame.f_lineno}


def run(hook, install, uninstall):
    global max_steps, out, stdin
    mode, path = sys.argv[1], sys.argv[2]
    if len(sys.argv) > 3:
        max_steps = int(sys.argv[3])
    with open(path) as f:
        src = f.read()
    hits.extend([0] * (src.count("\n") + 2))
    code = compile(src, MAIN, "exec")
    out = open(3, "w", buffering=1, closefd=False)
    out.write(json.dumps({"type": "hello", "protocol": 1, "language": "python3", "runtime": sys.version.split()[0], "adapter": hook}) + "\n")
    stdin = io.StringIO(sys.stdin.read())
    real_stdout = sys.stdout
    sys.stdin = stdin
    sys.stdout = Out(real_stdout)
    end = {"type": "exit", "kind": "normal", "code": 0}
    c0, t0 = time.process_time(), time.perf_counter()
    install(mode, code)
    try:
        exec(code, {"__name__": "__main__"})
    except BaseException as e:
        end = {"type": "exit", "kind": "exception", "message": f"{type(e).__name__}: {e}"}
    finally:
        uninstall()
    c1, t1 = time.process_time(), time.perf_counter()
    sys.stdout = real_stdout
    out.write(json.dumps(end) + "\n")
    out.flush()
    stats = {
        "hook": hook,
        "mode": mode,
        "cpu": c1 - c0,
        "wall": t1 - t0,
        "steps": steps,
        "hits": sum(hits),
        "hitsCrc": zlib.crc32(json.dumps(hits).encode()),
        "lineHits": {line: n for line, n in enumerate(hits) if n},
        "exit": end["kind"],
    }
    print(json.dumps(stats), file=sys.__stderr__)
