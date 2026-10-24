import struct

BLOCK = 4096
CHUNK = 64


def dirty(old, new, size):
    if old == new:
        return []
    out = []
    n = len(new)
    for b in range(0, n, BLOCK):
        if old[b:b + BLOCK] == new[b:b + BLOCK]:
            continue
        for c in range(b, min(b + BLOCK, n), CHUNK):
            if old[c:c + CHUNK] == new[c:c + CHUNK]:
                continue
            out += [i // size for i in range(c, min(c + CHUNK, n), size) if old[i:i + size] != new[i:i + size]]
    return out


def dirty_naive(old, new, size):
    fmt = "=%di" % (len(new) // size)
    return [i for i, (x, y) in enumerate(zip(struct.unpack(fmt, old), struct.unpack(fmt, new))) if x != y]
