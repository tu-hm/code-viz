import sys
import threading


def main():
    n = int(sys.stdin.readline() or 5)
    total = 0
    for i in range(n):
        total += i
    print(total)


sys.setrecursionlimit(1 << 20)
threading.stack_size(1 << 26)
t = threading.Thread(target=main)
t.start()
t.join()
