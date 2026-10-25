import sys
import threading


def dfs(v, adj, seen):
    seen[v] = True
    for u in adj[v]:
        if not seen[u]:
            dfs(u, adj, seen)


def main():
    n = int(input())
    adj = [[] for _ in range(n)]
    for _ in range(n - 1):
        a, b = map(int, input().split())
        adj[a].append(b)
        adj[b].append(a)
    seen = [False] * n
    dfs(0, adj, seen)
    print(sum(seen))


sys.setrecursionlimit(1 << 25)
threading.stack_size(1 << 27)
threading.Thread(target=main).start()
