from __future__ import annotations

import ast
import bisect
import builtins
import collections
import functools
import io
import itertools
import json
import opcode
import operator
import os
import random
import re
import sys
import threading
import types
from typing import TYPE_CHECKING, Any, Literal, NoReturn, cast

if TYPE_CHECKING:
    from _typeshed import TraceFunction
    from collections.abc import Callable, Mapping, Sequence
    from collections.abc import Set as AbstractSet
    from wire import (Entry, ErrorValues, Event, Exit, Frame, HeapObject, Local, Message, StdinPos, Step, StepError,
                      Value)

LANGUAGE = "python3"
ADAPTER = "py-settrace/0.3.0"
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
SUBSCRIPT = opcode.opmap["BINARY_SUBSCR"]
MAX_READS = 1000  # distinct cells per step; the core keeps the same (§11)
MONITOR = sys.monitoring.DEBUGGER_ID
# functools has no public type for @cache and @lru_cache wrappers
FUNCTIONS = (types.FunctionType, types.MethodType, types.BuiltinFunctionType,
             functools._lru_cache_wrapper)  # pyright: ignore[reportPrivateUsage]
THREAD_START = threading.Thread.start.__code__
INDEXABLE = (list, tuple, str, range, collections.deque)
SEQUENCES = (list, tuple, collections.deque)
ARITHMETIC: dict[type[ast.operator], Callable[[int, int], int]] = {
    ast.Add: int.__add__, ast.Sub: int.__sub__, ast.Mult: int.__mul__, ast.FloorDiv: int.__floordiv__,
    ast.Mod: int.__mod__, ast.BitXor: int.__xor__, ast.BitAnd: int.__and__, ast.BitOr: int.__or__,
    ast.LShift: int.__lshift__, ast.RShift: int.__rshift__}

wire: io.TextIOWrapper
max_steps = 1000
start_lines: set[int] = set()
capture: dict[str, tuple[int, int]] = {}  # variable name => (first index, count) to record of a long sequence (FR-11)
windows: dict[int, tuple[int, int]] = {}  # id of a captured variable's value => its (first index, count), this step
call_hook: TraceFunction
sent = 0
tail = False
next_call = 0
call_ids: dict[types.FrameType, int] = {}
pending: set[types.FrameType] = set()
last_lines: dict[types.FrameType, int | None] = {}
raised: dict[types.FrameType, BaseException] = {}
depths: dict[types.FrameType, int] = {}
starters: dict[threading.Thread, list[types.FrameType]] = {}
last_error: BaseException | None = None
hits: collections.Counter[int] = collections.Counter()
stdin: io.StringIO
stdin_text = ""
stdin_size = 0
stdin_read = 0
token_ends: list[int] = []
recursion_limit = sys.getrecursionlimit()
source = b""
spans: dict[tuple[int | None, int | None, int | None, int | None], ast.AST] | None = None
positions: dict[types.CodeType, list[tuple[int | None, int | None, int | None, int | None]]] = {}
reads: dict[tuple[int, int], object] = {}  # (id, index) => the sequence, kept alive so its id isn't reused before the step
reads_lost = False
watched: set[types.CodeType] = set()
set_recursion_limit = sys.setrecursionlimit


def send(msg: Message) -> None:
    wire.write(json.dumps(msg, separators=(",", ":")) + "\n")


class Writer(io.TextIOBase):
    def __init__(self, stream: Literal["stdout", "stderr"]) -> None:
        self.stream: Literal["stdout", "stderr"] = stream

    def write(self, s: object) -> int:
        if not isinstance(s, str):
            raise TypeError("write() argument must be str, not %s" % type(s).__name__)
        for i in range(0, len(s), OUT_CHUNK):
            send({"type": "out", "stream": self.stream, "data": s[i:i + OUT_CHUNK]})
        return len(s)


def code_of(fn: object) -> types.CodeType | None:
    return getattr(getattr(fn, "__wrapped__", fn), "__code__", None)


def defined_here(fn: Any) -> bool:
    code = code_of(fn)
    return code is not None and code.co_filename == SOURCE


def signature(fn: Any) -> str:
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


def summary(x: object) -> str:
    try:
        return repr(x)[:MAX_SUMMARY]
    except Exception:
        return "<%s>" % type(x).__name__


def fields(x: object) -> list[tuple[str, object]]:
    out: list[tuple[str, object]] = list(getattr(x, "__dict__", {}).items())
    for cls in type(x).__mro__:
        slots = cls.__dict__.get("__slots__", ())
        if isinstance(slots, str):
            slots = [slots]
        for name in slots:
            if name not in ("__dict__", "__weakref__") and hasattr(x, name):
                out.append((name, getattr(x, name)))
    return out


def encode(x: object, seen: set[int], todo: list[object]) -> Value:
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
    if id(x) not in seen:
        seen.add(id(x))
        todo.append(x)
    return {"t": "ref", "id": str(id(x))}


def heap_object(x: object, seen: set[int], todo: list[object]) -> HeapObject:
    kind = type(x)
    if isinstance(x, (list, tuple, collections.deque)):
        seq = cast("Sequence[object]", x)
        start, count = (0, MAX_ITEMS) if len(seq) <= MAX_ITEMS else windows.get(id(seq), (0, MAX_ITEMS))
        start = min(start, len(seq))
        items = [encode(v, seen, todo) for v in itertools.islice(seq, start, start + min(count, MAX_ITEMS))]
        obj: HeapObject = {"kind": "sequence", "type": kind.__name__, "length": len(seq), "items": items,
                           "truncated": len(items) < len(seq)}
        if len(items) < len(seq):
            obj["window"] = {"start": start, "count": len(items)}
        if isinstance(x, tuple):
            obj["fixed"] = True
        return obj
    if isinstance(x, (set, frozenset)):
        members = cast("AbstractSet[object]", x)
        items = [encode(v, seen, todo) for v in itertools.islice(members, MAX_ITEMS)]
        return {"kind": "set", "type": kind.__name__, "length": len(members), "items": items, "ordered": False,
                "truncated": len(members) > MAX_ITEMS}
    if isinstance(x, dict):
        mapping = cast("Mapping[object, object]", x)
        entries: list[Entry] = [{"key": encode(k, seen, todo), "value": encode(v, seen, todo)}
                                for k, v in itertools.islice(mapping.items(), MAX_ITEMS)]
        return {"kind": "mapping", "type": kind.__name__, "length": len(mapping), "entries": entries, "ordered": True,
                "truncated": len(mapping) > MAX_ITEMS}
    if isinstance(x, FUNCTIONS):
        return {"kind": "function", "name": x.__name__, "signature": signature(x)}
    if isinstance(x, type):
        return {"kind": "class", "name": x.__name__}
    if kind.__module__ == "__main__":
        return {"kind": "record", "type": kind.__name__,
                "fields": [{"name": k, "value": encode(v, seen, todo)} for k, v in fields(x)]}
    return {"kind": "opaque", "type": kind.__name__, "summary": summary(x)}


def frame_kind(code: types.CodeType) -> Literal["global", "function", "method", "lambda"]:
    if code.co_name == "<module>":
        return "global"
    if code.co_name == "<lambda>":
        return "lambda"
    parts = code.co_qualname.split(".")
    return "method" if len(parts) > 1 and parts[-2] != "<locals>" else "function"


def frame_object(frame: types.FrameType, seen: set[int], todo: list[object]) -> Frame:
    kind = frame_kind(frame.f_code)
    locals_: list[Local] = []
    for name, value in frame.f_locals.items():
        if name in capture:
            windows[id(value)] = capture[name]
        local: Local = {"name": name, "value": encode(value, seen, todo)}
        if ((kind == "global" and name.startswith("__")) or name.startswith(".") or isinstance(value, types.ModuleType)
                or (isinstance(value, FUNCTIONS) and not defined_here(value))):
            local["internal"] = True
        locals_.append(local)
    return {"id": str(call_ids[frame]), "name": frame.f_code.co_name, "kind": kind, "line": frame.f_lineno,
            "locals": locals_, "returnValue": None}


def stdin_pos() -> StdinPos:
    global stdin_read
    # exit() and quit() close sys.stdin before raising SystemExit
    if not stdin.closed:
        stdin_read = stdin.tell()
    pos = stdin_read
    n = pos if len(stdin_text) == stdin_size else len(stdin_text[:pos].encode("utf-8", "surrogateescape"))
    return {"bytes": n, "token": bisect.bisect_right(token_ends, n), "inferred": False}


def stack_of(frame: types.FrameType | None) -> list[types.FrameType]:
    frames: list[types.FrameType] = []
    while frame is not None:
        if frame.f_code.co_filename == SOURCE:
            frames.append(frame)
        frame = frame.f_back
    frames.reverse()
    return starters.get(threading.current_thread(), []) + frames


def step(frame: types.FrameType, event: Event, error: StepError | None = None, returned: object = None) -> None:
    global sent, tail, call_hook, reads_lost
    frames = stack_of(frame)
    kept = frames if len(frames) <= MAX_FRAMES + 1 else frames[:1] + frames[-MAX_FRAMES:]
    windows.clear()
    seen: set[int] = set()
    todo: list[object] = []
    stack = [frame_object(f, seen, todo) for f in kept]
    if event == "return" and stack[-1]["kind"] != "global":
        stack[-1]["returnValue"] = encode(returned, seen, todo)
    heap: dict[str, HeapObject] = {}
    while todo:
        x = todo.pop()
        heap[str(id(x))] = heap_object(x, seen, todo)

    line = frame.f_lineno
    if event == "call":
        prev = frames[-2].f_lineno if len(frames) > 1 else None
    else:
        prev = last_lines[frame]
    msg: Step = {"type": "step", "event": event, "line": line, "prevLine": prev, "stack": stack, "heap": heap,
                 "error": error, "stdinPos": stdin_pos()}
    if event in ("call", "return"):
        msg["callId"] = call_ids[frame]
    if event == "call" and len(frames) > 1:
        msg["parentCallId"] = call_ids[frames[-2]]
    if not reads_lost:
        msg["reads"] = [{"obj": str(oid), "index": index} for oid, index in reads if str(oid) in heap]
    reads.clear()
    reads_lost = False
    send(msg)
    pending.discard(frame)
    last_lines[frame] = line
    sent += 1
    if sent > max_steps:
        tail, call_hook = True, count_call
        sys.settrace(count_call)
        threading.settrace(count_call)
        for code in watched:
            sys.monitoring.set_local_events(MONITOR, code, 0)


def depth(frame: types.FrameType | None) -> int:
    n = 0
    while frame is not None:
        n += 1
        frame = frame.f_back
    return n


def setrecursionlimit(limit: int) -> None:
    global recursion_limit
    set_recursion_limit(limit + HEADROOM)
    recursion_limit = limit


def getrecursionlimit() -> int:
    return recursion_limit


def rearm(frame: types.FrameType, event: str, arg: Any) -> None:
    sys.setprofile(None)
    sys.settrace(call_hook)


def check_depth(frame: types.FrameType) -> None:
    outer = depths.get(frame.f_back) if frame.f_back is not None else None
    n = depth(frame) if outer is None else outer + 1
    # hook can't start past the real limit and CPython drops a hook that raises: raise here, rearm on unwind
    if n > recursion_limit:
        sys.setprofile(rearm)
        raise RecursionError("maximum recursion depth exceeded")
    depths[frame] = n


def join_thread(frame: types.FrameType, event: str, arg: Any) -> TraceFunction:
    thread: threading.Thread = frame.f_locals["self"]
    if event == "return" and thread.is_alive():
        thread.join()
    return join_thread


def on_call(frame: types.FrameType, event: str, arg: Any) -> TraceFunction | None:
    global next_call
    if tail:
        return count_call(frame, event, arg)
    # a thread started from main.py runs to the end before start() returns: one stack, one call tree
    if frame.f_code is THREAD_START and frame.f_back is not None and frame.f_back.f_code.co_filename == SOURCE:
        starters[frame.f_locals["self"]] = stack_of(frame.f_back)
        return join_thread
    if frame.f_code.co_filename != SOURCE:
        return None
    check_depth(frame)
    call_ids[frame] = next_call
    next_call += 1
    # settrace reports the call at the def line; the call step waits for the first body line
    pending.add(frame)
    watch(frame.f_code)
    return on_event


def node_at(code: types.CodeType, offset: int) -> ast.AST | None:
    global spans
    if spans is None:
        spans = {(node.lineno, node.end_lineno, node.col_offset, node.end_col_offset): node
                 for node in ast.walk(ast.parse(source)) if isinstance(node, (ast.Subscript, ast.BinOp, ast.AugAssign))}
    if code not in positions:
        positions[code] = list(code.co_positions())
    return spans.get(positions[code][offset // 2])


def evaluate(node: ast.AST, frame: types.FrameType) -> object:
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        for scope in (frame.f_locals, frame.f_globals, vars(builtins)):
            if node.id in scope:
                return scope[node.id]
    if isinstance(node, ast.Subscript):
        container, key = evaluate(node.value, frame), evaluate(node.slice, frame)
        # a key of another type can run __index__, __hash__ or __eq__
        if (type(container) in INDEXABLE or type(container) is dict) and type(key) in (int, str):
            return operator.getitem(cast(Any, container), key)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        x = evaluate(node.operand, frame)
        if type(x) is int:
            return -x
    if isinstance(node, ast.BinOp) and type(node.op) in ARITHMETIC:
        a, b = evaluate(node.left, frame), evaluate(node.right, frame)
        if type(a) is int and type(b) is int:
            return ARITHMETIC[type(node.op)](a, b)
    # anything else could run the program's code: a property, a __getitem__, a call
    raise LookupError("not evaluated")


def value_of(node: ast.AST, frame: types.FrameType) -> object:
    try:
        return evaluate(node, frame)
    except (LookupError, TypeError, ArithmeticError):
        return None


def explain(error: StepError, frame: types.FrameType, exc: BaseException) -> None:
    if isinstance(exc, RecursionError):
        error["kind"] = "recursion_too_deep"
        error["values"] = {"depth": len(stack_of(frame)), "limit": recursion_limit}
        return
    node = node_at(frame.f_code, frame.f_lasti)
    if isinstance(exc, ZeroDivisionError):
        error["kind"] = "division_by_zero"
        if isinstance(node, ast.BinOp):
            error["values"] = {"expr": ast.unparse(node), "divisor": ast.unparse(node.right)}
        elif isinstance(node, ast.AugAssign):
            error["values"] = {"expr": ast.unparse(node), "divisor": ast.unparse(node.value)}
        return
    # pop() on an empty list raises IndexError too: only a subscript is out of range
    if not isinstance(exc, IndexError) or not isinstance(node, ast.Subscript):
        return
    values: ErrorValues = {"name": ast.unparse(node.value)}
    container = value_of(node.value, frame)
    if type(container) in INDEXABLE:
        values["type"], values["size"] = type(container).__name__, len(cast("Sequence[object]", container))
    index = value_of(node.slice, frame)
    # a bigger one is no index at all, and str() raises past 4,300 digits
    if type(index) is int and abs(index) < 1 << 63:
        values["index"] = str(index)
    error["kind"], error["values"] = "index_out_of_range", values


def watch(code: types.CodeType) -> None:
    if code not in watched:
        watched.add(code)
        sys.monitoring.set_local_events(MONITOR, code, sys.monitoring.events.INSTRUCTION)


def on_instruction(code: types.CodeType, offset: int) -> object:
    if code.co_code[offset] != SUBSCRIPT:
        return sys.monitoring.DISABLE
    try:
        on_subscript(sys._getframe(1), node_at(code, offset))  # pyright: ignore[reportPrivateUsage]
    except Exception as e:
        crash(e)
    return None


def on_subscript(frame: types.FrameType, node: ast.AST | None) -> None:
    global reads_lost
    # BINARY_SUBSCR's position is its Subscript's span; container and index are on the stack, evaluated again here
    if not isinstance(node, ast.Subscript):
        return
    try:
        container, index = evaluate(node.value, frame), evaluate(node.slice, frame)
    except (LookupError, TypeError, ArithmeticError):
        return
    if type(container) not in SEQUENCES or type(index) is not int:
        return
    n = len(cast("Sequence[object]", container))
    if index < 0:
        index += n
    if not 0 <= index < n:
        return
    key = (id(container), index)
    if key not in reads and len(reads) == MAX_READS:
        reads_lost = True
        return
    reads[key] = container


def on_exception(frame: types.FrameType, exc: BaseException) -> None:
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
    error: StepError = {"type": type(exc).__name__, "message": str(exc), "line": frame.f_lineno}
    explain(error, frame, exc)
    step(frame, "exception", error=error)


def on_return(frame: types.FrameType, value: object) -> None:
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


def on_event(frame: types.FrameType, event: str, arg: Any) -> TraceFunction:
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


def count_call(frame: types.FrameType, event: str, arg: Any) -> TraceFunction | None:
    if frame.f_code.co_filename != SOURCE:
        return None
    check_depth(frame)
    return count_line


def count_line(frame: types.FrameType, event: str, arg: Any) -> TraceFunction:
    if event == "line":
        hits[frame.f_lineno] += 1
    elif event == "return":
        depths.pop(frame, None)
    return count_line


def wait_call(frame: types.FrameType, event: str, arg: Any) -> TraceFunction | None:
    if frame.f_code.co_filename != SOURCE:
        return None
    check_depth(frame)
    return wait_line


def wait_line(frame: types.FrameType, event: str, arg: Any) -> TraceFunction:
    if event == "line" and frame.f_lineno in start_lines:
        begin(frame)
        return on_event(frame, event, arg)
    count_line(frame, event, arg)
    return wait_line


def begin(frame: types.FrameType) -> None:
    global next_call, call_hook
    call_hook = on_call
    sys.settrace(on_call)
    threading.settrace(on_call)
    # frames already running get call ids as if traced from their call; their next line follows their call site
    for f in stack_of(frame):
        call_ids[f] = next_call
        next_call += 1
        last_lines[f] = f.f_lineno
        f.f_trace = on_event
        watch(f.f_code)
    last_lines[frame] = None


def wait_for_threads() -> None:
    for thread in threading.enumerate():
        if thread is not threading.current_thread() and not thread.daemon:
            thread.join()


def describe(exc: BaseException) -> str:
    message = str(exc)
    return "%s: %s" % (type(exc).__name__, message) if message else type(exc).__name__


def trace(path: str) -> Exit:
    global stdin, stdin_text, stdin_size, token_ends, max_steps, start_lines, call_hook, source
    max_steps = int(os.environ.get("VIZ_MAX_STEPS", "1000"))
    start_lines = {int(line) for line in os.environ.get("VIZ_START_AT_LINES", "").split(",") if line}
    ranges = cast("dict[str, list[list[int]]]", json.loads(os.environ.get("VIZ_CAPTURE_RANGES", "{}")))
    for name, pairs in ranges.items():
        first = min(start for start, _ in pairs)
        capture[name] = (first, max(end for _, end in pairs) - first + 1)
    with open(path, "rb") as f:
        src = f.read()
    source = src
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
    module.__dict__["__builtins__"] = builtins
    sys.modules["__main__"] = module

    kind, code, message = "normal", 0, None
    try:
        # dont_inherit: the user's program must not get this file's __future__ annotations
        program = compile(src, path, "exec", dont_inherit=True)
        call_hook = wait_call if start_lines else on_call
        sys.monitoring.use_tool_id(MONITOR, "viz")
        sys.monitoring.register_callback(MONITOR, sys.monitoring.events.INSTRUCTION, on_instruction)
        threading.settrace(call_hook)
        sys.settrace(call_hook)
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
    return {"type": "exit", "kind": kind, "code": code, "signal": None, "message": message, "lineHits": line_hits,
            "lineHitsSource": "counter"}


def crash(e: BaseException) -> NoReturn:
    send({"type": "log", "level": "error", "message": "%s: %s" % (type(e).__name__, str(e)[:200])})
    send({"type": "exit", "kind": "internal_error", "code": None, "signal": None, "message": None})
    os._exit(0)


def run(path: str) -> NoReturn:
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


def check(path: str) -> int:
    with open(path, "rb") as f:
        src = f.read()
    try:
        tree = ast.parse(src, path)
        compile(tree, path, "exec", dont_inherit=True)
    except SyntaxError as e:
        print("%s:%d:%d: error: %s" % (path, e.lineno or 1, e.offset or 1, e.msg), file=sys.stderr)
        return 1

    allow = set(os.environ.get("VIZ_MODULES_ALLOW", "").split(","))
    blocked: list[tuple[int, int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names = [alias.name.split(".")[0] for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            module = node.module or node.names[0].name
            names = ["." * node.level + module] if node.level else [module.split(".")[0]]
        else:
            continue
        blocked += [(node.lineno, node.col_offset + 1, name) for name in names if name not in allow]
    for line, col, name in sorted(blocked):
        print("%s:%d:%d: error: %s isn't supported in the visualizer" % (path, line, col, name), file=sys.stderr)
    return 3 if blocked else 0


if sys.argv[1] == "--check":
    sys.exit(check(sys.argv[2]))
run(sys.argv[1])
