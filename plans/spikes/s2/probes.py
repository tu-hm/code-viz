import json
import sys

mon = sys.monitoring
E = mon.events
TOOL = mon.DEBUGGER_ID


def local_events():
    code = compile("pass\n", "main.py", "exec")
    for name in ["PY_START", "PY_RESUME", "LINE", "JUMP", "PY_RETURN", "PY_YIELD", "RAISE", "PY_UNWIND", "EXCEPTION_HANDLED"]:
        try:
            mon.set_local_events(TOOL, code, getattr(E, name))
            print(f"set_local_events {name}: ok")
        except ValueError as e:
            print(f"set_local_events {name}: {e}")
        mon.set_local_events(TOOL, code, 0)


def work():
    for _ in range(3):
        json.dumps({"a": [1, 2]}, indent=1)


def disable():
    calls = {"json": 0}

    def line(code, n):
        if "/json/" in code.co_filename:
            calls["json"] += 1
        return mon.DISABLE

    mon.register_callback(TOOL, E.LINE, line)
    mon.set_events(TOOL, E.LINE)
    for label in ["first run", "second run", "after set_events", "after restart_events"]:
        if label == "after set_events":
            mon.set_events(TOOL, E.LINE | E.PY_START)
        if label == "after restart_events":
            mon.restart_events()
        calls["json"] = 0
        work()
        print(f"DISABLE, LINE callbacks in json code, {label}: {calls['json']}")
    mon.set_events(TOOL, 0)


def callback_errors():
    src = compile("x = 1\ny = 2\n", "main.py", "exec")

    def line(code, n):
        if code.co_filename == "main.py" and n == 2:
            raise RuntimeError("callback failed")

    mon.register_callback(TOOL, E.LINE, line)
    mon.set_events(TOOL, E.LINE)
    for run in range(2):
        try:
            exec(src, {})
        except RuntimeError as e:
            print(f"monitoring, run {run}: error reached user code: {e}")
    print(f"monitoring: events still set: {mon.get_events(TOOL) != 0}")
    mon.set_events(TOOL, 0)

    def trace(frame, event, arg):
        if frame.f_code.co_filename != "main.py":
            return None
        if event == "line" and frame.f_lineno == 2:
            raise RuntimeError("hook failed")
        return trace

    sys.settrace(trace)
    for run in range(2):
        try:
            exec(src, {})
        except RuntimeError as e:
            print(f"settrace, run {run}: error reached user code: {e}")
    print(f"settrace: hook still set: {sys.gettrace() is not None}")
    sys.settrace(None)


if __name__ == "__main__":
    mon.use_tool_id(TOOL, "s2-probes")
    local_events()
    disable()
    callback_errors()
    mon.free_tool_id(TOOL)
