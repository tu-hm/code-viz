import sys

sys.setrecursionlimit(100)


def down(n):
    return down(n + 1)


try:
    down(0)
except RecursionError as e:
    print("caught:", e)
print("done")
