import sys


def depth(n):
    try:
        return depth(n + 1)
    except RecursionError:
        return n


reached = depth(0)
print("limit", sys.getrecursionlimit(), "reached", reached)
after = reached + 1
print("after", after)
