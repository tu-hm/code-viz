import ast
import bisect
import builtins
import collections
import functools
import io
import itertools
import json
import opcode
import os
import random
import re
import sys
import threading
import types

LANGUAGE = "python3"
ADAPTER = "py-settrace/0.1.0"
SOURCE = "main.py"
STDIN = "/work/stdin"
MAX_ITEMS = 1000
MAX_STR = 1000
MAX_SUMMARY = 200
MAX_FRAMES = 100  # innermost, besides the module frame; the core keeps the same (§11)
OUT_CHUNK = 1 << 14  # chars; at most 64 KiB as utf-8
HEADROOM = 50  # frames kept free above the user's recursion limit for the hook and the writers
CO_VARARGS = 0x04
CO_VARKEYWORDS = 0x08
RETURNS = {opcode.opmap["RETURN_VALUE"], opcode.opmap["RETURN_CONST"], opcode.opmap["YIELD_VALUE"]}
FUNCTIONS = (types.FunctionType, types.MethodType, types.BuiltinFunctionType, functools._lru_cache_wrapper)
THREAD_START = threading.Thread.start.__code__

wire = None
max_steps = 1000
sent = 0
tail = False
next_call = 0
call_ids = {}
pending = set()
last_lines = {}
raised = {}
depths = {}
starters = {}
last_error = None
hits = collections.Counter()
stdin = None
stdin_text = ""
stdin_size = 0
stdin_read = 0
token_ends = []
recursion_limit = sys.getrecursionlimit()
set_recursion_limit = sys.setrecursionlimit


def send(msg):
    wire.write(json.dumps(msg, separators=(",", ":")) + "\n")


class Writer(io.TextIOBase):
    def __init__(self, stream):
        self.stream = stream

    def write(self, s):
        if not isinstance(s, str):
            raise TypeError("write() argument must be str, not %s" % type(s).__name__)
        for i in range(0, len(s), OUT_CHUNK):
            send({"type": "out", "stream": self.stream, "data": s[i:i + OUT_CHUNK]})
        return len(s)


def code_of(fn):
    return getattr(getattr(fn, "__wrapped__", fn), "__code__", None)


def defined_here(fn):
    code = code_of(fn)
    return code is not None and code.co_filename == SOURCE


def signature(fn):
    code = code_of(fn)
    if code is None:
        return fn.__name__ + "(...)"
    n = code.co_argcount + code.co_kwonlyargcount
    names = list(code.co_varnames[:n])
    if code.co_flags & CO_VARARGS:
        names.insert(code.co_argcount, "*" + code.co_varnames[n])
        n += 1
    if code.co_flags & CO_VARKEYWORDS:
        names.append("**" + code.co_varnames[n])
    if isinstance(fn, types.MethodType):
        names = names[1:]
    return "%s(%s)" % (fn.__name__, ", ".join(names))


def summary(x):
    try:
        return repr(x)[:MAX_SUMMARY]
    except Exception:
        return "<%s>" % type(x).__name__


def fields(x):
    out = list(getattr(x, "__dict__", {}).items())
    for cls in type(x).__mro__:
        slots = cls.__dict__.get("__slots__", ())
        if isinstance(slots, str):
            slots = [slots]
        for name in slots:
            if name not in ("__dict__", "__weakref__") and hasattr(x, name):
                out.append((name, getattr(x, name)))
    return out


def encode(x, heap, todo):
    if x is None:
        return {"t": "none"}
    if isinstance(x, bool):
        return {"t": "bool", "v": "True" if x else "False"}
    if isinstance(x, int):
        try:
            return {"t": "int", "v": int.__repr__(x)}
        except ValueError:
            return {"t": "unavailable", "reason": "int over %d digits" % sys.get_int_max_str_digits()}
    if isinstance(x, float):
        return {"t": "float", "v": float.__repr__(x)}
    if isinstance(x, str):
        if len(x) <= MAX_STR:
            return {"t": "str", "v": x}
        return {"t": "str", "v": x[:MAX_STR], "len": len(x), "truncated": True}
    key = str(id(x))
    if key not in heap:
        heap[key] = None
        todo.append(x)
    return {"t": "ref", "id": key}


def heap_object(x, heap, todo):
    kind = type(x)
    if isinstance(x, (list, tuple, collections.deque)):
        items = [encode(v, heap, todo) for v in itertools.islice(x, MAX_ITEMS)]
        obj = {"kind": "sequence", "type": kind.__name__, "length": len(x), "items": items,
               "truncated": len(x) > MAX_ITEMS}
        if isinstance(x, tuple):
            obj["fixed"] = True
        return obj
    if isinstance(x, (set, frozenset)):
        items = [encode(v, heap, todo) for v in itertools.islice(x, MAX_ITEMS)]
        return {"kind": "set", "type": kind.__name__, "length": len(x), "items": items, "ordered": False,
                "truncated": len(x) > MAX_ITEMS}
    if isinstance(x, dict):
        entries = [{"key": encode(k, heap, todo), "value": encode(v, heap, todo)}
                   for k, v in itertools.islice(x.items(), MAX_ITEMS)]
        return {"kind": "mapping", "type": kind.__name__, "length": len(x), "entries": entries, "ordered": True,
                "truncated": len(x) > MAX_ITEMS}
    if isinstance(x, FUNCTIONS):
        return {"kind": "function", "name": x.__name__, "signature": signature(x)}
    if isinstance(x, type):
        return {"kind": "class", "name": x.__name__}
    if kind.__module__ == "__main__":
        return {"kind": "record", "type": kind.__name__,
                "fields": [{"name": k, "value": encode(v, heap, todo)} for k, v in fields(x)]}
    return {"kind": "opaque", "type": kind.__name__, "summary": summary(x)}


def frame_kind(code):
    if code.co_name == "<module>":
        return "global"
    if code.co_name == "<lambda>":
        return "lambda"
    parts = code.co_qualname.split(".")
    return "method" if len(parts) > 1 and parts[-2] != "<locals>" else "function"


def frame_object(frame, heap, todo):
    kind = frame_kind(frame.f_code)
    locals_ = []
    for name, value in frame.f_locals.items():
        local = {"name": name, "value": encode(value, heap, todo)}
        if ((kind == "global" and name.startswith("__")) or name.startswith(".") or isinstance(value, types.ModuleType)
                or (isinstance(value, FUNCTIONS) and not defined_here(value))):
            local["internal"] = True
        locals_.append(local)
    return {"id": str(call_ids[frame]), "name": frame.f_code.co_name, "kind": kind, "line": frame.f_lineno,
            "locals": locals_, "returnValue": None}


def stdin_pos():
    global stdin_read
    # exit() and quit() close sys.stdin before raising SystemExit
    if not stdin.closed:
        stdin_read = stdin.tell()
    pos = stdin_read
    n = pos if len(stdin_text) == stdin_size else len(stdin_text[:pos].encode("utf-8", "surrogateescape"))
    return {"bytes": n, "token": bisect.bisect_right(token_ends, n), "inferred": False}


def stack_of(frame):
    frames = []
    while frame is not None:
        if frame.f_code.co_filename == SOURCE:
            frames.append(frame)
        frame = frame.f_back
    frames.reverse()
    return starters.get(threading.current_thread(), []) + frames


def step(frame, event, error=None, returned=None):
    global sent, tail
    frames = stack_of(frame)
    kept = frames if len(frames) <= MAX_FRAMES + 1 else frames[:1] + frames[-MAX_FRAMES:]
    heap, todo = {}, []
    stack = [frame_object(f, heap, todo) for f in kept]
    if event == "return" and stack[-1]["kind"] != "global":
        stack[-1]["returnValue"] = encode(returned, heap, todo)
    while todo:
        x = todo.pop()
        heap[str(id(x))] = heap_object(x, heap, todo)

    line = frame.f_lineno
    if event == "call":
        prev = frames[-2].f_lineno if len(frames) > 1 else None
    else:
        prev = last_lines[frame]
    msg = {"type": "step", "event": event, "line": line, "prevLine": prev, "stack": stack, "heap": heap,
           "error": error, "stdinPos": stdin_pos()}
    if event in ("call", "return"):
        msg["callId"] = call_ids[frame]
    if event == "call" and len(frames) > 1:
        msg["parentCallId"] = call_ids[frames[-2]]
    send(msg)
    pending.discard(frame)
    last_lines[frame] = line
    sent += 1
    if sent > max_steps:
        tail = True
        sys.settrace(count_call)
        threading.settrace(count_call)


def depth(frame):
    n = 0
    while frame is not None:
        n += 1
        frame = frame.f_back
    return n


def setrecursionlimit(limit):
    global recursion_limit
    set_recursion_limit(limit + HEADROOM)
    recursion_limit = limit


def getrecursionlimit():
    return recursion_limit


def rearm(frame, event, arg):
    sys.setprofile(None)
    sys.settrace(count_call if tail else on_call)


def check_depth(frame):
    outer = depths.get(frame.f_back)
    n = depth(frame) if outer is None else outer + 1
    # hook can't start past the real limit and CPython drops a hook that raises: raise here, rearm on unwind
    if n > recursion_limit:
        sys.setprofile(rearm)
        raise RecursionError("maximum recursion depth exceeded")
    depths[frame] = n


def join_thread(frame, event, arg):
    thread = frame.f_locals["self"]
    if event == "return" and thread.is_alive():
        thread.join()
    return join_thread


def on_call(frame, event, arg):
    global next_call
    if tail:
        return count_call(frame, event, arg)
    # a thread started from main.py runs to the end before start() returns: one stack, one call tree
    if frame.f_code is THREAD_START and frame.f_back.f_code.co_filename == SOURCE:
        starters[frame.f_locals["self"]] = stack_of(frame.f_back)
        return join_thread
    if frame.f_code.co_filename != SOURCE:
        return None
    check_depth(frame)
    call_ids[frame] = next_call
    next_call += 1
    # settrace reports the call at the def line; the call step waits for the first body line
    pending.add(frame)
    return on_event


def on_exception(frame, exc):
    global last_error
    raised[frame] = exc
    # closing a suspended generator throws GeneratorExit into it; not the user's error
    if isinstance(exc, (GeneratorExit, SystemExit)) or exc is last_error:
        return
    if frame in pending:
        step(frame, "call")
    if tail:
        return
    last_error = exc
    step(frame, "exception", error={"type": type(exc).__name__, "message": str(exc), "line": frame.f_lineno})


def on_return(frame, value):
    exc = raised.pop(frame, None)
    # 3.12 sends no exception event on RERAISE (finally, with); an unwinding frame stops on a non-return opcode
    returned = frame.f_code.co_code[frame.f_lasti] in RETURNS
    if returned or (isinstance(exc, SystemExit) and frame.f_code.co_name == "<module>"):
        if frame in pending:
            step(frame, "call")
        if not tail:
            step(frame, "return", returned=value)
    call_ids.pop(frame, None)
    depths.pop(frame, None)
    pending.discard(frame)
    last_lines.pop(frame, None)


def on_event(frame, event, arg):
    if tail:
        return count_line(frame, event, arg)
    try:
        if event == "line":
            hits[frame.f_lineno] += 1
            step(frame, "call" if frame in pending else "line")
        elif event == "exception":
            on_exception(frame, arg[1])
        elif event == "return":
            on_return(frame, arg)
    except Exception as e:
        crash(e)
    return count_line if tail else on_event


def count_call(frame, event, arg):
    if frame.f_code.co_filename != SOURCE:
        return None
    check_depth(frame)
    return count_line


def count_line(frame, event, arg):
    if event == "line":
        hits[frame.f_lineno] += 1
    elif event == "return":
        depths.pop(frame, None)
    return count_line


def wait_for_threads():
    for thread in threading.enumerate():
        if thread is not threading.current_thread() and not thread.daemon:
            thread.join()


def describe(exc):
    message = str(exc)
    return "%s: %s" % (type(exc).__name__, message) if message else type(exc).__name__


def trace(path):
    global stdin, stdin_text, stdin_size, token_ends, max_steps
    max_steps = int(os.environ.get("VIZ_MAX_STEPS", "1000"))
    with open(path, "rb") as f:
        src = f.read()
    try:
        with open(STDIN, "rb") as f:
            raw = f.read()
    except FileNotFoundError:
        raw = b""
    stdin_text = raw.decode("utf-8", "surrogateescape")
    stdin_size = len(raw)
    token_ends = [m.end() for m in re.finditer(rb"\S+", raw)]
    stdin = io.StringIO(stdin_text)

    sys.stdin = stdin
    sys.stdout = Writer("stdout")
    sys.stderr = Writer("stderr")
    sys.argv = [path]
    random.seed(0)
    setrecursionlimit(recursion_limit)
    sys.setrecursionlimit = setrecursionlimit
    sys.getrecursionlimit = getrecursionlimit
    module = types.ModuleType("__main__")
    module.__builtins__ = builtins
    sys.modules["__main__"] = module

    kind, code, message = "normal", 0, None
    try:
        program = compile(src, path, "exec")
        threading.settrace(on_call)
        sys.settrace(on_call)
        exec(program, module.__dict__)
    except SystemExit as e:
        if isinstance(e.code, int):
            code = e.code
        elif e.code is not None:
            print(e.code, file=sys.stderr)
            code = 1
    except BaseException as e:
        kind, code, message = "exception", 1, describe(e)
    wait_for_threads()
    sys.settrace(None)
    sys.setprofile(None)
    line_hits = {str(line): n for line, n in sorted(hits.items())}
    return {"type": "exit", "kind": kind, "code": code, "signal": None, "message": message, "lineHits": line_hits}


def crash(e):
    send({"type": "log", "level": "error", "message": "%s: %s" % (type(e).__name__, str(e)[:200])})
    send({"type": "exit", "kind": "internal_error", "code": None, "signal": None, "message": None})
    os._exit(0)


def run(path):
    global wire
    wire = open(int(os.environ["VIZ_PROTOCOL_FD"]), "w", encoding="utf-8", buffering=1)
    send({"type": "hello", "protocol": 1, "language": LANGUAGE, "runtime": "CPython %d.%d.%d" % sys.version_info[:3],
          "adapter": ADAPTER})
    try:
        send(trace(path))
    except Exception as e:
        crash(e)
    # exit is the last message: skip atexit handlers and finalizers that could still print
    os._exit(0)


def check(path):
    with open(path, "rb") as f:
        src = f.read()
    try:
        tree = ast.parse(src, path)
        compile(tree, path, "exec")
    except SyntaxError as e:
        print("%s:%d:%d: error: %s" % (path, e.lineno or 1, e.offset or 1, e.msg), file=sys.stderr)
        return 1

    allow = set(os.environ.get("VIZ_MODULES_ALLOW", "").split(","))
    blocked = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names = [alias.name.split(".")[0] for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.level:
            names = ["." * node.level + (node.module or node.names[0].name)]
        elif isinstance(node, ast.ImportFrom):
            names = [node.module.split(".")[0]]
        else:
            continue
        blocked += [(node.lineno, node.col_offset + 1, name) for name in names if name not in allow]
    for line, col, name in sorted(blocked):
        print("%s:%d:%d: error: %s isn't supported in the visualizer" % (path, line, col, name), file=sys.stderr)
    return 3 if blocked else 0


if sys.argv[1] == "--check":
    sys.exit(check(sys.argv[2]))
run(sys.argv[1])
