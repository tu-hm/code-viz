import sys

import monitoring_tracer
import snapshot
from snapshot import MAIN, emit, error, hits

calls = []
module_code = None
hybrid = False
next_id = 0
last_exc = None


def on_call(frame, event, arg):
    global next_id
    if frame.f_code.co_filename != MAIN:
        return None
    next_id += 1
    calls.append([next_id, True, False])
    return on_event


def on_event(frame, event, arg):
    global last_exc
    entry = calls[-1]
    if event == "line":
        hits[frame.f_lineno] += 1
        entry[2] = False
        if entry[1]:
            entry[1] = False
            emit("call", frame, entry[0])
        else:
            emit("line", frame, entry[0])
    elif event == "return":
        calls.pop()
        if not entry[2]:
            emit("return", frame, entry[0], ret=arg)
    elif event == "exception":
        entry[2] = True
        exc = arg[1]
        if exc is not last_exc:
            last_exc = exc
            emit("exception", frame, entry[0], error=error(exc, frame))
    if snapshot.steps >= snapshot.max_steps:
        return to_counter(frame)
    return on_event


def to_counter(frame):
    if hybrid:
        return to_monitoring_counter(frame)
    sys.settrace(count_call)
    f = frame.f_back
    while f is not None:
        if f.f_code.co_filename == MAIN:
            f.f_trace = count_line
        f = f.f_back
    return count_line


def to_monitoring_counter(frame):
    sys.settrace(None)
    f = frame.f_back
    while f is not None:
        f.f_trace = None
        f = f.f_back
    monitoring_tracer.install("count", module_code)
    return None


def count_call(frame, event, arg):
    if frame.f_code.co_filename != MAIN:
        return None
    return count_line


def count_line(frame, event, arg):
    if event == "line":
        hits[frame.f_lineno] += 1
    return count_line


def install(mode, code):
    global module_code, hybrid
    module_code = code
    hybrid = mode == "full-hybrid"
    if mode in ("full", "full-hybrid"):
        sys.settrace(on_call)
    elif mode == "count":
        sys.settrace(count_call)


def uninstall():
    sys.settrace(None)
    if hybrid and monitoring_tracer.codes:
        monitoring_tracer.uninstall()


if __name__ == "__main__":
    snapshot.run("settrace", install, uninstall)
