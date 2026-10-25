import sys
import types

import snapshot
from snapshot import MAIN, emit, error, hits

mon = sys.monitoring
E = mon.events
TOOL = mon.DEBUGGER_ID
DISABLE = mon.DISABLE
LOCAL = E.PY_START | E.PY_RESUME | E.LINE | E.JUMP | E.PY_RETURN | E.PY_YIELD

codes = []
lines_of = {}
calls = []
next_id = 0
last_exc = None


def on_start(code, offset):
    global next_id
    next_id += 1
    calls.append([next_id, True])


def on_resume(code, offset):
    global next_id
    next_id += 1
    calls.append([next_id, False])


def on_line(code, line):
    step_line(sys._getframe(1), line)


def on_jump(code, src, dst):
    lines = lines_of[id(code)]
    line = lines[dst]
    if dst > src or line != lines[src]:
        return DISABLE
    step_line(sys._getframe(1), line)


def step_line(frame, line):
    hits[line] += 1
    entry = calls[-1]
    if entry[1]:
        entry[1] = False
        emit("call", frame, entry[0])
    else:
        emit("line", frame, entry[0])
    if snapshot.steps >= snapshot.max_steps:
        to_counter()


def on_return(code, offset, retval):
    entry = calls.pop()
    emit("return", sys._getframe(1), entry[0], ret=retval)
    if snapshot.steps >= snapshot.max_steps:
        to_counter()


def on_raise(code, offset, exc):
    global last_exc
    if code.co_filename != MAIN or exc is last_exc:
        return
    last_exc = exc
    frame = sys._getframe(1)
    emit("exception", frame, calls[-1][0], error=error(exc, frame))
    if snapshot.steps >= snapshot.max_steps:
        to_counter()


def on_unwind(code, offset, exc):
    if code.co_filename != MAIN:
        return
    calls.pop()


def to_counter():
    mon.set_events(TOOL, 0)
    mon.register_callback(TOOL, E.LINE, count_line)
    mon.register_callback(TOOL, E.JUMP, count_jump)
    for c in codes:
        mon.set_local_events(TOOL, c, E.LINE | E.JUMP)


def count_line(code, line):
    hits[line] += 1


def count_jump(code, src, dst):
    lines = lines_of[id(code)]
    line = lines[dst]
    if dst > src or line != lines[src]:
        return DISABLE
    hits[line] += 1


def count_line_global(code, line):
    if code.co_filename != MAIN:
        return DISABLE
    hits[line] += 1


def main_codes(code):
    yield code
    for c in code.co_consts:
        if type(c) is types.CodeType:
            yield from main_codes(c)


def offset_lines(code):
    lines = {}
    for start, end, line in code.co_lines():
        for offset in range(start, end, 2):
            lines[offset] = line
    return lines


def install(mode, code):
    codes.extend(main_codes(code))
    for c in codes:
        lines_of[id(c)] = offset_lines(c)
    mon.use_tool_id(TOOL, "s2")
    if mode == "full":
        mon.register_callback(TOOL, E.PY_START, on_start)
        mon.register_callback(TOOL, E.PY_RESUME, on_resume)
        mon.register_callback(TOOL, E.LINE, on_line)
        mon.register_callback(TOOL, E.JUMP, on_jump)
        mon.register_callback(TOOL, E.PY_RETURN, on_return)
        mon.register_callback(TOOL, E.PY_YIELD, on_return)
        mon.register_callback(TOOL, E.RAISE, on_raise)
        mon.register_callback(TOOL, E.PY_UNWIND, on_unwind)
        for c in codes:
            mon.set_local_events(TOOL, c, LOCAL)
        mon.set_events(TOOL, E.RAISE | E.PY_UNWIND)
    elif mode == "count":
        mon.register_callback(TOOL, E.LINE, count_line)
        mon.register_callback(TOOL, E.JUMP, count_jump)
        for c in codes:
            mon.set_local_events(TOOL, c, E.LINE | E.JUMP)
    elif mode == "count-nojump":
        mon.register_callback(TOOL, E.LINE, count_line)
        for c in codes:
            mon.set_local_events(TOOL, c, E.LINE)
    elif mode == "count-global":
        mon.register_callback(TOOL, E.LINE, count_line_global)
        mon.set_events(TOOL, E.LINE)


def uninstall():
    mon.set_events(TOOL, 0)
    for c in codes:
        mon.set_local_events(TOOL, c, 0)
    mon.free_tool_id(TOOL)


if __name__ == "__main__":
    snapshot.run("monitoring", install, uninstall)
