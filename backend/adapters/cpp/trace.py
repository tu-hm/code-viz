import array
import collections
import fcntl
import itertools
import json
import math
import os
import re
import signal
import struct
import termios
import traceback

import gdb

LANGUAGE = "cpp17-gcc"
ADAPTER = "cpp-gdb/0.3.0"
SOURCE = "main.cpp"
STDIN = "/work/stdin"
WIRE_FD = 3
MAX_ITEMS = 100  # per container read item by item; at 1,000 a map through the printers took 13.5 s per 1,000 steps
SPARSE_MIN = 64  # longer arrays of scalars go sparse (§19.9.1)
MAX_CELLS = 10000  # non-default cells per sparse sequence; more => window only (§19.9.1)
WINDOW = 1000  # cells a window-only sequence keeps (§11 items per container)
MAX_ARRAY_BYTES = 4 << 20  # whole reads per array, else window only (§19.9.1)
MAX_READ_BYTES = 16 << 20  # whole reads per step (§19.9.1)
BLOCK = 4096
CHUNK = 64
MAX_STR = 1000  # per string (§11); a std::string counts bytes
MAX_OBJECTS = 500  # heap objects per step (§11)
MAX_SUMMARY = 200  # opaque text, as python cuts repr (§10.3)
PAGE = 4096
MAX_DEPTH = 32  # pointer hops from a local or global (§11 maxPointerDepth)
MAX_FRAMES = 100  # innermost, besides the globals frame; the core keeps the same (§11)
CHARS = ("char", "signed char", "unsigned char")
INT_FORMATS = {1: "b", 2: "h", 4: "i", 8: "q"}
FLOAT_FORMATS = {4: "f", 8: "d"}
# libstdc++ printers raise these on garbage memory, such as a dangling std::string
UNREADABLE = (gdb.error, OverflowError, ValueError)

DW_LNS_COPY = 1
DW_LNS_ADVANCE_PC = 2
DW_LNS_ADVANCE_LINE = 3
DW_LNS_SET_FILE = 4
DW_LNS_SET_COLUMN = 5
DW_LNS_NEGATE_STMT = 6
DW_LNS_CONST_ADD_PC = 8
DW_LNS_FIXED_ADVANCE_PC = 9
DW_LNE_END_SEQUENCE = 1
DW_LNE_SET_ADDRESS = 2
DW_LNCT_PATH = 1
DW_FORM_STRING = 0x08
DW_FORM_UDATA = 0x0F
DW_FORM_LINE_STRP = 0x1F
DW_FORM_SIZES = {0x05: 2, 0x06: 4, 0x07: 8, 0x0B: 1, 0x0E: 4, 0x1E: 16}

wire = os.fdopen(WIRE_FD, "w", buffering=1)
os.set_inheritable(WIRE_FD, False)
stops = []
returning = []
call_ids = itertools.count()
temps = itertools.count()
user_types = {}
declarations = {}
type_names = {}
shown = {}  # key => sparse sequence as the core holds it after the last step message
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "typemap.json")) as f:
    TYPEMAP = json.load(f)
# _GLIBCXX_DEBUG containers live in std::__debug, list and string in std::__cxx11
TEMPLATE = re.compile(r"std::(?:(?:__debug|__cxx11|__cxx1998)::)*(\w+)(?:<.*>)?$")
STRING = "std::basic_string<char, std::char_traits<char>, std::allocator<char> >"


class Return(gdb.FinishBreakpoint):
    def stop(self):
        returning.append(self)
        return True


def send(msg):
    wire.write(json.dumps(msg, separators=(",", ":")) + "\n")
    # program writes fd 1/2 itself => keep it stopped until viz-shim has read this line, or its next output can overtake it (§10.1)
    while struct.unpack("i", fcntl.ioctl(WIRE_FD, termios.FIONREAD, bytes(4)))[0]:
        os.sched_yield()  # sleep(10 µs) instead: 1,000 steps 0.2 s => 1.5 s in a 1-vCPU box


def run(cmd):
    gdb.execute(cmd, to_string=True)


def ours(symtab):
    return symtab is not None and os.path.basename(symtab.filename) == SOURCE


def string(s):
    # gdb 14 doesn't export gdb.LazyString
    if type(s).__name__ != "LazyString":
        return {"t": "str", "v": str(s)}
    raw = gdb.selected_inferior().read_memory(s.address, min(s.length, MAX_STR) * s.type.target().sizeof)
    out = {"t": "str", "v": raw.tobytes().decode("utf-8", "replace")}
    if s.length > MAX_STR:
        out["len"], out["truncated"] = s.length, True
    return out


def float_text(x, size):
    if size == 4 and math.isfinite(x):
        for digits in range(1, 10):
            short = float("%.*g" % (digits, x))
            if array.array("f", [short])[0] == x:
                return repr(short)
    return repr(x)


def number(t, x):
    if t.code == gdb.TYPE_CODE_BOOL:
        return {"t": "bool", "v": "true" if x else "false"}
    if t.code == gdb.TYPE_CODE_FLT:
        return {"t": "float", "v": float_text(x, t.sizeof)}
    if t.name in CHARS:
        return {"t": "char", "v": chr(x % 256), "code": x}
    return {"t": "int", "v": str(x)}


def scalar(value, t):
    if t.code in (gdb.TYPE_CODE_INT, gdb.TYPE_CODE_CHAR, gdb.TYPE_CODE_BOOL) and t.sizeof > 8:
        # gdb 14 int() refuses __int128; its text is exact
        return {"t": "int", "v": str(value)}
    if t.code in (gdb.TYPE_CODE_INT, gdb.TYPE_CODE_CHAR, gdb.TYPE_CODE_BOOL):
        return number(t, int(value))
    if t.code == gdb.TYPE_CODE_FLT and t.sizeof <= 8:
        return number(t, float(value))
    if t.code == gdb.TYPE_CODE_FLT:
        # float() rounds long double to double; gdb's text keeps every digit
        return {"t": "float", "v": str(value)}
    if t.code == gdb.TYPE_CODE_ENUM:
        return {"t": "int", "v": str(value)}
    return None


def type_name(t):
    key = str(t)
    # whatis on a VLA reads its bound outside the frame: int [281474976709841]
    if "std::" not in key:
        return key
    if key not in type_names:
        # gdb applies libstdc++'s type printers in whatis only: std::vector<int>, not std::vector<int, std::allocator<int> >
        gdb.set_convenience_variable("viz", gdb.Value(0).cast(t.pointer()))
        text = gdb.execute("whatis *$viz", to_string=True).removeprefix("type = ").rstrip("\n")
        # ...but not to template arguments: std::vector<std::__cxx11::basic_string<char, ...> >
        for inner, short in (("std::__debug::", "std::"), ("std::__cxx11::", "std::"), (STRING, "std::string"), (" >", ">")):
            text = text.replace(inner, short)
        type_names[key] = text
    return type_names[key]


def encode(value, snap, depth):
    out = item(value, snap, depth)
    out["type"] = type_name(value.type)
    return out


def item(value, snap, depth):
    try:
        return convert(value, snap, depth)
    except UNREADABLE:
        return {"t": "unavailable", "reason": "unreadable"}


def convert(value, snap, depth):
    if value.is_optimized_out:
        return {"t": "unavailable", "reason": "optimized_out"}
    t = value.type.strip_typedefs()
    if t.code in (gdb.TYPE_CODE_REF, gdb.TYPE_CODE_RVALUE_REF):
        return convert(value.referenced_value(), snap, depth)
    if t.code != gdb.TYPE_CODE_PTR:
        return scalar(value, t) or reference(value, snap, depth)
    pointee = t.target()
    if pointee == pointee.const() and pointee.strip_typedefs().unqualified().name == "char" and int(value) != 0:
        return c_string(int(value)) or pointer(value, pointee, snap, depth)
    return pointer(value, pointee, snap, depth)


def c_string(addr):
    raw = b""
    # reads end on page boundaries: a short literal at the end of a mapping is readable
    while b"\0" not in raw and len(raw) <= MAX_STR:
        at = addr + len(raw)
        try:
            raw += gdb.selected_inferior().read_memory(at, min(MAX_STR + 1 - len(raw), PAGE - at % PAGE)).tobytes()
        except gdb.MemoryError:
            return None
    text = raw.split(b"\0", 1)[0]
    out = {"t": "str", "v": text[:MAX_STR].decode("utf-8", "replace")}
    if len(text) > MAX_STR:
        out["truncated"] = True
    return out


def user_type(t):
    t = t.strip_typedefs()
    if t.code not in (gdb.TYPE_CODE_STRUCT, gdb.TYPE_CODE_UNION) or t.name is None:
        return False
    if t.name not in user_types:
        sym = gdb.lookup_symbol(t.name, domain=gdb.SYMBOL_STRUCT_DOMAIN)[0]
        user_types[t.name] = sym is not None and ours(sym.symtab)
    return user_types[t.name]


def pointer(value, pointee, snap, depth):
    addr = int(value)
    out = {"t": "ptr", "addr": hex(addr)}
    if addr == 0 or depth == MAX_DEPTH:
        return out
    if not user_type(pointee):
        snap["ptrs"].append((out, addr, pointee))
        return out
    target = value.dereference()
    try:
        target.fetch_lazy()
    except gdb.MemoryError:
        return out
    key = add(target, snap, depth + 1)
    if key is not None:
        out["target"] = key
    return out


def reference(value, snap, depth):
    if row(value.type).get("kind") == "str":
        return string(gdb.default_visualizer(value).to_string())
    key = add(value, snap, depth)
    if key is None:
        return {"t": "unavailable", "reason": "object_limit"}
    return {"t": "ref", "id": key}


def row(t):
    m = TEMPLATE.match(t.strip_typedefs().tag or "")
    return TYPEMAP.get("std::" + m.group(1), {}) if m else {}


def address(value):
    # gdb 14 mallocs in the inferior for .address of an array outside memory; an element's .address doesn't
    while value.type.strip_typedefs().code == gdb.TYPE_CODE_ARRAY:
        value = value[0]
    return None if value.address is None else int(value.address)


def add(value, snap, depth):
    addr = address(value)
    where = "tmp%d" % next(temps) if addr is None else hex(addr)
    key = "%s:%s" % (where, value.type.strip_typedefs().unqualified())
    heap = snap["heap"]
    if key not in heap:
        if len(heap) == MAX_OBJECTS:
            return None
        heap[key] = None
        snap["todo"].append((key, value, depth))
    return key


def heap_object(key, value, snap, depth):
    name = type_name(value.type.unqualified())
    t = value.type.strip_typedefs()
    if t.code == gdb.TYPE_CODE_ARRAY:
        return dict(c_array(key, value, snap, depth), type=name)
    r = row(t)
    if r:
        return dict(READERS[r.get("read", "printer")](key, value, r, snap, depth), type=name)
    if t.code not in (gdb.TYPE_CODE_STRUCT, gdb.TYPE_CODE_UNION) or not (t.name is None or user_type(t)):
        return {"kind": "opaque", "type": name, "summary": str(value)[:MAX_SUMMARY]}
    found = fields(value, t, snap, depth)
    count = collections.Counter(field for _, field, _ in found)
    return {"kind": "record", "type": name,
            "fields": [{"name": field if owner is None or count[field] == 1 else "%s::%s" % (owner, field), "value": v}
                       for owner, field, v in found]}


def fields(value, t, snap, depth):
    out = []
    for f in t.fields():
        # static members have no bitpos
        if f.artificial or not hasattr(f, "bitpos"):
            continue
        if f.is_base_class and user_type(f.type) or f.name is None:
            inner = value.cast(f.type) if f.is_base_class else value[f]
            out += [(owner or f.type.name, field, v) for owner, field, v in fields(inner, f.type.strip_typedefs(), snap, depth)]
        elif f.is_base_class:
            out.append((None, type_name(f.type), encode(value.cast(f.type), snap, depth)))
        else:
            out.append((None, f.name, encode(value[f], snap, depth)))
    return out


def checked_length(n):
    # a dangling or uninitialised container reads garbage
    if not 0 <= n < 1 << 32:
        raise ValueError("length %d" % n)
    return n


def sequence(items, length):
    obj = {"kind": "sequence", "length": length, "items": items, "truncated": len(items) < length}
    if len(items) < length:
        obj["window"] = {"start": 0, "count": len(items)}
    return obj


def contiguous(base, addr, elem, length, head, snap, depth):
    t = elem.strip_typedefs()
    if addr is not None and length > SPARSE_MIN and unpack_format(t):
        size = t.sizeof
        whole = length * size <= MAX_ARRAY_BYTES and snap["read"] + length * size <= MAX_READ_BYTES
        n = length if whole else min(length, WINDOW)
        snap["read"] += n * size
        # one read per array per step, diffed when the step is sent: 200k ints 0.1 ms (S6)
        raw = gdb.selected_inferior().read_memory(addr, n * size).tobytes()
        return dict(head, kind="sequence", length=length, read=(t, raw))
    n = min(length, MAX_ITEMS)
    items = scalars(addr, elem, n) if n else []
    if items is None:
        items = [item(base[i], snap, depth) for i in range(n)]
    return dict(sequence(items, length), **head)


def c_array(key, value, snap, depth):
    t = value.type.strip_typedefs()
    lo, hi = t.range()
    length = hi - lo + 1
    elem = t.target()
    addr = address(value)
    if addr is not None:
        e = elem.strip_typedefs()
        snap["arrays"].append((addr, length, e.sizeof, str(e.unqualified()), key))
    return contiguous(value, addr, elem, length, {"fixed": True}, snap, depth)


def bits(addr, n):
    raw = gdb.selected_inferior().read_memory(addr, (n + 7) // 8).tobytes() if n else b""
    # little-endian words: bit i is in byte i // 8
    return [{"t": "bool", "v": "true" if raw[i // 8] >> i % 8 & 1 else "false"} for i in range(n)]


def printer(key, value, r, snap, depth):
    length = value
    for field in r["length"].split("."):
        length = length[field]
    return children(value, r, checked_length(int(length)), snap, depth)


def children(value, r, length, snap, depth):
    n = min(length, MAX_ITEMS)
    kids = gdb.default_visualizer(value).children()
    if r["kind"] == "mapping":
        got = [c for _, c in itertools.islice(kids, 2 * n)]
        entries = [{"key": item(k, snap, depth), "value": item(v, snap, depth)} for k, v in zip(got[::2], got[1::2])]
        return {"kind": "mapping", "length": length, "entries": entries, "ordered": r["ordered"],
                "truncated": len(entries) < length}
    items = [item(c, snap, depth) for _, c in itertools.islice(kids, n)]
    if r["kind"] == "set":
        return {"kind": "set", "length": length, "items": items, "ordered": r["ordered"], "truncated": len(items) < length}
    return sequence(items, length)


def std_deque(key, value, r, snap, depth):
    start, finish = value["_M_impl"]["_M_start"], value["_M_impl"]["_M_finish"]
    per = max(512 // value.type.strip_typedefs().template_argument(0).sizeof, 1)
    length = (per * int(finish["_M_node"] - start["_M_node"] - 1) + int(start["_M_last"] - start["_M_cur"])
              + int(finish["_M_cur"] - finish["_M_first"]))
    return children(value, r, checked_length(length), snap, depth)


def std_vector(key, value, r, snap, depth):
    impl = value["_M_impl"]
    elem = value.type.strip_typedefs().template_argument(0)
    if elem.strip_typedefs().code == gdb.TYPE_CODE_BOOL:
        start, finish = impl["_M_start"]["_M_p"], impl["_M_finish"]["_M_p"]
        word = 8 * start.dereference().type.sizeof
        length = checked_length(word * int(finish - start) + int(impl["_M_finish"]["_M_offset"]))
        obj = sequence(bits(int(start), min(length, MAX_ITEMS)), length)
        obj["meta"] = {"capacity": word * int(impl["_M_end_of_storage"] - start)}
        return obj
    start = impl["_M_start"]
    head = {"meta": {"capacity": int(impl["_M_end_of_storage"] - start)}}
    return contiguous(start, int(start), elem, checked_length(int(impl["_M_finish"] - start)), head, snap, depth)


def std_array(key, value, r, snap, depth):
    # array<T, 0> holds an empty struct, not a T[0]
    if int(value.type.strip_typedefs().template_argument(1)) == 0:
        return dict(sequence([], 0), fixed=True)
    return c_array(key, value["_M_elems"], snap, depth)


def std_bitset(key, value, r, snap, depth):
    length = int(value.type.strip_typedefs().template_argument(0))
    # bitset<0> has no _M_w
    items = bits(int(value["_M_w"].address), min(length, MAX_ITEMS)) if length else []
    return dict(sequence(items, length), fixed=True)


def std_adapter(key, value, r, snap, depth):
    obj = heap_object(key, value["c"], snap, depth)
    obj["meta"] = {"adapter": TEMPLATE.match(value.type.strip_typedefs().tag).group(1)}
    return obj


def std_pair(key, value, r, snap, depth):
    return {"kind": "record", "fields": [{"name": f, "value": encode(value[f], snap, depth)} for f in ("first", "second")]}


def std_tuple(key, value, r, snap, depth):
    kids = gdb.default_visualizer(value).children()
    return {"kind": "record", "fields": [{"name": str(i), "value": encode(c, snap, depth)} for i, (_, c) in enumerate(kids)]}


READERS = {"printer": printer, "deque": std_deque, "vector": std_vector, "array": std_array, "bitset": std_bitset,
           "adapter": std_adapter, "pair": std_pair, "tuple": std_tuple}


def scalars(addr, elem, n):
    t = elem.strip_typedefs()
    fmt = unpack_format(t)
    if fmt is None or addr is None:
        return None
    # one read per array, not one gdb.Value per item: 100 ints 0.13 ms => 0.02 ms
    raw = gdb.selected_inferior().read_memory(addr, n * t.sizeof)
    return [number(t, x) for x in struct.unpack("=%d%s" % (n, fmt), raw)]


def unpack_format(t):
    if t.code == gdb.TYPE_CODE_FLT:
        return FLOAT_FORMATS.get(t.sizeof)
    if t.code not in (gdb.TYPE_CODE_INT, gdb.TYPE_CODE_CHAR, gdb.TYPE_CODE_BOOL) or t.sizeof not in INT_FORMATS:
        return None
    if t.is_signed:
        return INT_FORMATS[t.sizeof]
    return INT_FORMATS[t.sizeof].upper()


def new_snap():
    return {"heap": {}, "todo": collections.deque(), "arrays": [], "ptrs": [], "read": 0}


def send_step(msg):
    global shown
    now = {}
    msg["heap"] = {key: wire_object(key, obj, now) for key, obj in msg["heap"].items()}
    shown = now
    send(msg)


def wire_object(key, obj, now):
    if "read" in obj:
        out, now[key] = sparse(obj, shown.get(key))
        return out
    if "sparse" not in obj and "patch" not in obj:
        return obj
    # a return step reuses its frame's objects from an earlier step
    if key in shown:
        now[key] = shown[key]
        return {"kind": "sequence", "type": obj["type"], "length": obj["length"], "patch": {}}
    if "sparse" in obj:
        return obj
    return {"kind": "opaque", "type": obj["type"], "summary": "unavailable"}


def sparse(obj, prev):
    t, raw = obj["read"]
    head = {k: v for k, v in obj.items() if k != "read"}
    size, length = t.sizeof, obj["length"]
    pattern, real = "=" + INT_FORMATS[size], "=" + unpack_format(t)
    again = prev is not None and prev["head"] == head and len(prev["raw"]) == len(raw)
    if again:
        default, count = prev["default"], prev["count"]
        dirty = changed_cells(prev["raw"], raw, size)
        for i in dirty:
            old, new = struct.unpack_from(pattern, prev["raw"], i * size)[0], struct.unpack_from(pattern, raw, i * size)[0]
            count += (new != default) - (old != default)
        # pick the default again once per crossing: Counter over 200k ints takes 5 ms
        if count > min(MAX_CELLS, length // 2) >= prev["count"]:
            default, count = most_common(raw, size)
    else:
        default, count = most_common(raw, size)
    window = None if count <= MAX_CELLS and len(raw) == length * size else min(length, WINDOW)
    state = {"head": head, "raw": raw, "default": default, "count": count, "window": window}

    def cell(i):
        return number(t, struct.unpack_from(real, raw, i * size)[0])

    if again and default == prev["default"] and window == prev["window"]:
        return {"kind": "sequence", "type": obj["type"], "length": length,
                "patch": {str(i): cell(i) for i in dirty if window is None or i < window}}, state
    values = struct.unpack("=%d%s" % (len(raw) // size, INT_FORMATS[size]), raw)[:window]
    out = dict(head, sparse={"default": number(t, struct.unpack(real, struct.pack(pattern, default))[0]),
                             "items": {str(i): cell(i) for i, v in enumerate(values) if v != default}})
    if window is not None:
        out["truncated"], out["window"] = True, {"start": 0, "count": window}
    return out, state


def most_common(raw, size):
    if raw.count(0) == len(raw):
        return 0, 0
    values = struct.unpack("=%d%s" % (len(raw) // size, INT_FORMATS[size]), raw)
    default = collections.Counter(values).most_common(1)[0][0]
    return default, len(values) - values.count(default)


def changed_cells(old, new, size):
    if old == new:
        return []
    n = len(new)
    blocks = [b for b in range(0, n, BLOCK) if old[b:b + BLOCK] != new[b:b + BLOCK]]
    if 2 * len(blocks) * BLOCK > n:
        # most blocks dirty (sort, fill): one unpack beats slicing every chunk, 22 ms => 6 ms at 200k ints (S6)
        fmt = "=%d%s" % (n // size, INT_FORMATS[size])
        return [i for i, (x, y) in enumerate(zip(struct.unpack(fmt, old), struct.unpack(fmt, new))) if x != y]
    out = []
    for b in blocks:
        for c in range(b, min(b + BLOCK, n), CHUNK):
            if old[c:c + CHUNK] != new[c:c + CHUNK]:
                out += [i // size for i in range(c, min(c + CHUNK, n), size) if old[i:i + size] != new[i:i + size]]
    return out


def fill(snap):
    heap, todo = snap["heap"], snap["todo"]
    while todo:
        key, value, depth = todo.popleft()
        try:
            heap[key] = heap_object(key, value, snap, depth)
        except UNREADABLE:
            heap[key] = {"kind": "opaque", "type": type_name(value.type.unqualified()), "summary": "unreadable"}
    for out, addr, pointee in snap["ptrs"]:
        name = str(pointee.strip_typedefs().unqualified())
        for start, length, size, elem, key in snap["arrays"]:
            if elem == name and start <= addr < start + length * size and (addr - start) % size == 0:
                out["target"], out["index"] = key, (addr - start) // size
                break
    return heap


def local(name, value):
    out = {"name": name, "value": value}
    if name.startswith("__"):
        out["internal"] = True
    return out


def local_values(frame, line, snap, scope, again):
    blocks = []
    block = frame.block()
    while block is not None:
        blocks.append(block)
        if block.function is not None:
            break
        block = block.superblock

    keys = [(b.start, b.end) for b in blocks]
    if scope["line"] is not None and (scope["line"] != line or again):
        for k in scope["live"]:
            scope["ran"][k].add(scope["line"])
    for k in keys:
        if k not in scope["live"]:
            scope["ran"][k] = set()
    scope["line"], scope["live"] = line, keys

    out = []
    for block, k in reversed(list(zip(blocks, keys))):
        # gdb lists a function's own block in declaration order, nested blocks in hash order
        syms = block if block.function is not None else sorted(block, key=lambda s: (s.line, s.name))
        for sym in syms:
            if not (sym.is_variable or sym.is_argument) or (not sym.is_argument and sym.line > line):
                continue
            if not sym.is_argument and sym.line == line and line not in scope["ran"][k]:
                value = {"t": "uninit", "type": type_name(sym.type)}
            else:
                value = variable(sym, frame, snap)
            out.append(local(sym.name, value))
    return out


def variable(sym, frame, snap):
    try:
        value = sym.value() if frame is None else sym.value(frame)
    except UNREADABLE:
        return {"t": "unavailable", "reason": "unreadable", "type": type_name(sym.type)}
    return encode(value, snap, 0)


def global_symbols(symtab):
    syms = [s for block in (symtab.global_block(), symtab.static_block()) for s in block
            if s.is_variable and ours(s.symtab)]
    return sorted(syms, key=lambda s: (s.line, s.name))


def sections(path):
    with open(path, "rb") as f:
        elf = f.read()
    table, = struct.unpack_from("<Q", elf, 0x28)
    size, count, names = struct.unpack_from("<HHH", elf, 0x3A)
    headers = [struct.unpack_from("<IIQQQQ", elf, table + i * size) for i in range(count)]
    strtab = headers[names][4]
    return {elf[strtab + name:elf.index(b"\0", strtab + name)].decode(): elf[offset:offset + length]
            for name, _, _, _, offset, length in headers}


def uleb(data, pos):
    value = shift = 0
    while True:
        byte = data[pos]
        pos += 1
        value |= (byte & 0x7F) << shift
        shift += 7
        if byte < 0x80:
            return value, pos


def sleb(data, pos):
    value, end = uleb(data, pos)
    if data[end - 1] & 0x40:
        value -= 1 << (7 * (end - pos))
    return value, end


def paths(data, pos, strings):
    count, pos = data[pos], pos + 1
    formats = []
    for _ in range(count):
        kind, pos = uleb(data, pos)
        form, pos = uleb(data, pos)
        formats.append((kind, form))
    count, pos = uleb(data, pos)
    out = []
    for _ in range(count):
        for kind, form in formats:
            if form == DW_FORM_LINE_STRP:
                at, = struct.unpack_from("<I", data, pos)
                value, pos = strings[at:strings.index(b"\0", at)], pos + 4
            elif form == DW_FORM_STRING:
                end = data.index(b"\0", pos)
                value, pos = data[pos:end], end + 1
            elif form == DW_FORM_UDATA:
                value, pos = uleb(data, pos)
            else:
                value, pos = None, pos + DW_FORM_SIZES[form]
            if kind == DW_LNCT_PATH:
                out.append(value.decode())
    return out, pos


def unit_rows(data, unit, end, strings):
    addr_size = data[unit + 6]
    header_length, min_length, _, default_stmt, line_base, line_range, opcode_base = struct.unpack_from(
        "<IBBBbBB", data, unit + 8)
    operands = data[unit + 18:unit + 17 + opcode_base]
    _, pos = paths(data, unit + 17 + opcode_base, strings)
    files, _ = paths(data, pos, strings)
    source = {i for i, path in enumerate(files) if os.path.basename(path) == SOURCE}

    rows = []
    pos = unit + 12 + header_length
    addr, file, line, col, stmt = 0, 1, 1, 0, default_stmt
    while pos < end:
        op = data[pos]
        pos += 1
        if op >= opcode_base:
            addr += (op - opcode_base) // line_range * min_length
            line += line_base + (op - opcode_base) % line_range
        elif op == DW_LNS_ADVANCE_PC:
            n, pos = uleb(data, pos)
            addr += n * min_length
        elif op == DW_LNS_ADVANCE_LINE:
            n, pos = sleb(data, pos)
            line += n
        elif op == DW_LNS_SET_FILE:
            file, pos = uleb(data, pos)
        elif op == DW_LNS_SET_COLUMN:
            col, pos = uleb(data, pos)
        elif op == DW_LNS_NEGATE_STMT:
            stmt = not stmt
        elif op == DW_LNS_CONST_ADD_PC:
            addr += (255 - opcode_base) // line_range * min_length
        elif op == DW_LNS_FIXED_ADVANCE_PC:
            addr += struct.unpack_from("<H", data, pos)[0]
            pos += 2
        elif op == 0:
            n, pos = uleb(data, pos)
            if data[pos] == DW_LNE_END_SEQUENCE:
                addr, file, line, col, stmt = 0, 1, 1, 0, default_stmt
            elif data[pos] == DW_LNE_SET_ADDRESS:
                addr = int.from_bytes(data[pos + 1:pos + 1 + addr_size], "little")
            pos += n
        elif op != DW_LNS_COPY:
            for _ in range(operands[op - 1]):
                _, pos = uleb(data, pos)
        if (op >= opcode_base or op == DW_LNS_COPY) and stmt and file in source:
            rows.append((addr, line, col))
    return rows


def statement_rows(path):
    # gdb's own line table drops rows whose line repeats with a new discriminator: a one-line loop's back edge
    secs = sections(path)
    data, strings = secs[".debug_line"], secs[".debug_line_str"]
    rows = []
    unit = 0
    while unit < len(data):
        length, version = struct.unpack_from("<IH", data, unit)
        if version == 5:
            rows += unit_rows(data, unit, unit + 4 + length, strings)
        unit += 4 + length
    return rows


def function_block(pc):
    block = gdb.block_for_pc(pc)
    while block is not None and block.function is None:
        block = block.superblock
    return block


def declaration(cls):
    name = str(cls)
    if name not in declarations:
        gdb.set_convenience_variable("viz", gdb.Value(0).cast(cls.pointer()))
        declarations[name] = gdb.execute("ptype/r *$viz", to_string=True)
    return declarations[name]


def generated(block):
    fn = block.function
    # reserved names: gcc's __tcf_0, _GLOBAL__sub_I_main, a lambda's _FUN
    if re.match(r"_[_A-Z]", fn.name):
        return True
    params = fn.type.fields()
    if not params or not params[0].artificial or any(s.is_argument and s.name == "__closure" for s in block):
        return False
    cls = params[0].type.target().unqualified()
    prefix = str(cls) + "::"
    # gdb names a lambda's other members without their class: ~<lambda>(void)
    rest = fn.name[len(prefix):] if fn.name.startswith(prefix) else fn.name
    name = "operator()" if rest.startswith("operator()") else rest.split("(")[0]
    signature = " %s(%s)" % (name, ", ".join(str(p.type) for p in params[1:]) or "void")
    # gdb 14 has no Symbol.is_artificial; ptype leaves out methods marked DW_AT_artificial (implicit ones)
    return signature not in declaration(cls)


def return_row(block, pcs):
    arch = gdb.selected_inferior().architecture()
    for pc, end in reversed(list(zip(pcs, pcs[1:] + [block.end]))):
        if any(insn["asm"].startswith("ret") for insn in arch.disassemble(pc, end - 1)):
            return pc
    return None


def body_stops(block, rows):
    pcs = sorted(rows)
    end = return_row(block, pcs)
    # gcc -O0 returns from the closing brace's row; VLA saves, temporaries and cleanups share its position
    closing = None if end is None else rows[end]
    body = pcs[1:]
    start = next((i for i, pc in enumerate(body) if rows[pc] != closing), 0)
    return {pc: (rows[pc][0], rows[pc] == closing) for pc in body[start:]}


def line_stops(path):
    blocks, rows = {}, collections.defaultdict(dict)
    for pc, line, col in statement_rows(path):
        block = function_block(pc)
        if block is not None and ours(block.function.symtab):
            blocks[block.start] = block
            rows[block.start][pc] = (line, col)
    stops_at = {}
    for start, block in blocks.items():
        if not generated(block):
            stops_at.update(body_stops(block, rows[start]))
    return stops_at


def frame_kind(frame):
    block = frame.block()
    while block.function is None:
        block = block.superblock
    args = [s.name for s in block if s.is_argument]
    # gcc names a lambda's object parameter __closure
    if "__closure" in args:
        return "lambda"
    if "this" in args:
        return "method"
    return "function"


def frame_name(frame, kind):
    if kind == "lambda":
        return "<lambda>"
    # gdb 14 keeps the parameter list of an abi-tagged name: make_str[abi:cxx11](int)
    return frame.name().split("[abi:")[0]


def result_address(frame, returns):
    arch = frame.architecture()
    if arch.name() != "aarch64" or returns.strip_typedefs().code not in (gdb.TYPE_CODE_STRUCT, gdb.TYPE_CODE_UNION):
        return None
    # aapcs64 result address in x8 isn't kept, gdb 14 reads x8 at return; gcc -O0 saves it iff result in memory
    start = int(frame.function().value().address)
    prologue = arch.disassemble(start, gdb.find_pc_line(start).last)
    if not any(re.search(r"\bx8\b", insn["asm"]) for insn in prologue):
        return None
    return int(frame.read_register("x8"))


def stack_of(calls, globals_, snap, line, again=None):
    stack = []
    if globals_:
        stack.append({"id": "globals", "name": "Globals", "kind": "global", "line": line,
                      "locals": [local(s.name, variable(s, None, snap)) for s in globals_], "returnValue": None})
    shown = calls[-MAX_FRAMES:]
    for call in shown:
        frame = call["frame"]
        if again is None or call is not shown[-1]:
            frame_line, frame_again = frame.find_sal().line, False
        else:
            frame_line, frame_again = line, again
        stack.append({"id": str(call["id"]), "name": call["name"], "kind": call["kind"], "line": frame_line,
                      "locals": local_values(frame, frame_line, snap, call["scope"], frame_again),
                      "returnValue": None})
    return stack


def snapshot(event, line, prev_line, calls, globals_, again=False):
    snap = new_snap()
    stack = stack_of(calls, globals_, snap, line, again)
    return step(event, line, prev_line, stack, fill(snap))


def step(event, line, prev_line, stack, heap, error=None):
    return {"type": "step", "event": event, "line": line, "prevLine": prev_line, "stack": stack, "heap": heap,
            "error": error}


def armed(call):
    return call["finish"] is not None and call["finish"].is_valid()


def arm(call):
    call["finish"] = None
    # gdb 14 never fires a FinishBreakpoint under an inline caller (allocator destroy); outer one shares return address
    frame, caller = call["frame"], call["frame"].older()
    while caller is not None and caller.type() == gdb.INLINE_FRAME:
        frame, caller = caller, caller.older()
    if caller is None:
        return
    try:
        gdb.selected_inferior().read_memory(caller.pc(), 1)
    except gdb.MemoryError:
        # smashed return address: no breakpoint fits there, and the return itself faults
        return
    call["finish"] = Return(frame, internal=True)


def disarm(call):
    if armed(call):
        call["finish"].delete()
    call["finish"] = None


def flush(call):
    pending = call["pending"]
    if pending["sent"] or not pending["due"]:
        return []
    pending["sent"] = True
    msg = pending["msg"]
    call["line"], call["pc"], call["shown"], call["seen"] = msg["line"], pending["pc"], pending["pc"], msg
    return [msg]


def called(frame, pc, line, calls, globals_):
    kind = frame_kind(frame)
    name = frame_name(frame, kind)
    msgs = []
    prev_line = None
    if calls:
        pending = calls[-1]["pending"]
        # closing-brace code that runs a destructor is the epilogue; one that runs a constructor sets up a temporary
        if pending is not None and not pending["stale"] and "::~" in name:
            msgs = flush(calls[-1])
        prev_line = calls[-1]["frame"].find_sal().line
        # finish breakpoint on innermost call only: gdb unwinds to each one's frame per stop (depth 300: 3.3 s => 0.6 s)
        disarm(calls[-1])
    returns = frame.function().type.target()
    call = {"id": next(call_ids), "frame": frame, "name": name, "kind": kind,
            "returns": returns, "result_at": result_address(frame, returns), "line": line, "pc": pc,
            "shown": pc, "pending": None, "finish": None, "scope": {"line": None, "live": [], "ran": {}}}
    calls.append(call)
    arm(call)
    msg = snapshot("call", line, prev_line, calls, globals_)
    msg["callId"] = call["id"]
    if len(calls) > 1:
        msg["parentCallId"] = calls[-2]["id"]
    call["seen"] = msg
    return msgs + [msg]


def at_row(frame, pc, row, calls, globals_):
    line, closing = row
    # an exception or longjmp left these frames without a return
    while calls and not calls[-1]["frame"].is_valid():
        disarm(calls.pop())
    if not calls or frame != calls[-1]["frame"]:
        return called(frame, pc, line, calls, globals_)
    call = calls[-1]
    if not armed(call):
        arm(call)
    backward = pc <= call["pc"]
    # same line => step only on a jump back past what it showed: a one-line loop's next iteration, not a range-for's
    due = line != call["line"] or (backward and call["shown"] <= pc)
    pending = call["pending"]
    if closing:
        if pending is None or pending["stale"]:
            msg = snapshot("line", line, call["line"], calls, globals_, line == call["line"])
            call["pending"] = {"msg": msg, "pc": pc, "due": due, "before": call["line"], "sent": False, "stale": False}
        return []
    call["pc"] = pc
    if pending is not None and line == pending["before"] and pc > pending["pc"]:
        # same statement after a temporary's setup, or its return value moved after the epilogue's destructors
        pending["stale"] = True
        return []
    call["pending"] = None
    if backward:
        call["shown"] = 0
    if not due:
        return []
    msg = snapshot("line", line, call["line"], calls, globals_, line == call["line"])
    call["line"], call["shown"], call["seen"] = line, pc, msg
    return [msg]


def returned(call, calls, globals_):
    msgs = flush(call) if call["pending"] is not None else []
    seen = call["seen"] if call["pending"] is None else call["pending"]["msg"]
    snap = new_snap()
    stack = stack_of(calls[-(MAX_FRAMES - 1):], globals_, snap, call["line"])
    value = call["finish"].return_value
    if call["result_at"] is not None:
        value = gdb.Value(gdb.selected_inferior().read_memory(call["result_at"], call["returns"].sizeof),
                          call["returns"])
    if call["returns"].code == gdb.TYPE_CODE_VOID:
        result = None
    elif value is None:
        result = {"t": "unavailable", "reason": "unknown_return", "type": type_name(call["returns"])}
    else:
        result = encode(value, snap, 0)
    heap = fill(snap)
    # frame already popped: its locals and objects come from its last stop, the epilogue's when it had one
    stack.append(dict(seen["stack"][-1], line=call["line"], returnValue=result))
    msg = step("return", call["line"], call["line"], stack, dict(seen["heap"], **heap))
    msg["callId"] = call["id"]
    return msgs + [msg]


def crashed(name, calls, globals_, last):
    error = {"type": name, "message": signal.strsignal(signal.Signals[name])}
    while calls and not calls[-1]["frame"].is_valid():
        calls.pop()
    if not calls:
        # no frame left to read (a smashed return address): the last step's state
        error["line"] = last["line"]
        return step("exception", last["line"], last["line"], last["stack"], last["heap"], error)
    line = calls[-1]["frame"].find_sal().line
    error["line"] = line
    return snapshot("exception", line, calls[-1]["line"], calls, globals_) | {"error": error}


def finished(stop):
    if isinstance(stop, gdb.SignalEvent):
        return {"type": "exit", "kind": "signal", "code": None, "signal": stop.stop_signal, "message": None}
    if hasattr(stop, "exit_code"):
        return {"type": "exit", "kind": "normal", "code": stop.exit_code, "signal": None, "message": None}
    killed = signal.Signals(int(gdb.convenience_variable("_exitsignal")))
    # SIGKILL comes from outside (oom killer): die the same way so the core applies its limits (§11)
    if killed == signal.SIGKILL:
        os.kill(os.getpid(), signal.SIGKILL)
    return {"type": "exit", "kind": "signal", "code": None, "signal": killed.name, "message": None}


def untraced(breaks, calls):
    for bp in breaks:
        bp.delete()
    for call in calls:
        disarm(call)
    run("continue")
    return finished(stops[-1])


def open_stdin():
    try:
        fd = os.open(STDIN, os.O_RDONLY)
    except FileNotFoundError:
        fd = os.open(os.devnull, os.O_RDONLY)
    os.dup2(fd, 0)
    os.close(fd)


def trace():
    max_steps = int(os.environ.get("VIZ_MAX_STEPS", "1000"))
    for cmd in ("set pagination off", "set confirm off", "set suppress-cli-notifications on",
                "set print inferior-events off", "set print thread-events off", "set startup-with-shell off",
                "set disable-randomization on", "set backtrace past-main on",
                # breakpoints stay in memory between stops: 700 of them, 1.8 s => 0.5 s per 1,000 steps
                "set breakpoint always-inserted on"):
        run(cmd)

    main = gdb.lookup_global_symbol("main")
    producer = (main.symtab.producer or "").split()
    runtime = "GCC " + producer[2] if len(producer) > 2 and producer[0] == "GNU" else "unknown"
    send({"type": "hello", "protocol": 1, "language": LANGUAGE, "runtime": runtime, "adapter": ADAPTER})

    globals_ = global_symbols(main.symtab)
    lines = line_stops(gdb.current_progspace().filename)
    body = function_block(int(main.value().address))
    entry = min(pc for pc in lines if body.start <= pc < body.end)
    # breakpoints only once main runs: global constructors stay untraced and fast
    breaks = [gdb.Breakpoint("*%#x" % entry, internal=True)]
    open_stdin()
    run("run")
    null = os.open(os.devnull, os.O_RDWR)
    for fd in (0, 1, 2):
        os.dup2(null, fd)
    os.close(null)

    calls, last, sent = [], None, 0
    while True:
        stop = stops[-1]
        stops.clear()
        if isinstance(stop, gdb.ExitedEvent):
            return finished(stop)
        if isinstance(stop, gdb.SignalEvent):
            if calls:
                send_step(crashed(stop.stop_signal, calls, globals_, last))
            return finished(stop)
        frame = gdb.newest_frame()
        pc = frame.pc()
        if last is None:
            breaks.pop().delete()
            breaks = [gdb.Breakpoint("*%#x" % at, internal=True) for at in lines]
            msgs = called(frame, pc, lines[pc][0], calls, globals_)
        else:
            msgs = []
            if returning:
                returning.clear()
                msgs = returned(calls.pop(), calls, globals_)
                if calls:
                    arm(calls[-1])
            if calls and pc in lines:
                msgs += at_row(frame, pc, lines[pc], calls, globals_)
        for msg in msgs:
            send_step(msg)
            last, sent = msg, sent + 1
            if sent > max_steps:
                return untraced(breaks, calls)
        if not calls:
            return untraced(breaks, calls)
        run("continue")


gdb.events.stop.connect(stops.append)
gdb.events.exited.connect(stops.append)
try:
    send(trace())
except Exception as e:
    where = " < ".join(str(f.lineno) for f in reversed(traceback.extract_tb(e.__traceback__)) if f.filename == __file__)
    send({"type": "log", "level": "error", "message": "%s at trace.py:%s" % (type(e).__name__, where)})
    send({"type": "exit", "kind": "internal_error", "code": None, "signal": None, "message": None})
