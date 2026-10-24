import sys

sys.setrecursionlimit(25)


def down(n):
    return down(n + 1)


down(0)
