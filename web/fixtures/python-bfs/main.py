from collections import deque

n = 6
edges = [(1, 2), (1, 3), (1, 4), (2, 5), (4, 5), (5, 6)]
adj = [[] for _ in range(n + 1)]
for u, v in edges:
    adj[u].append(v)
    adj[v].append(u)
dist = [-1] * (n + 1)
dist[1] = 0
q = deque([1])
while q:
    u = q.popleft()
    for v in adj[u]:
        if dist[v] != -1:
            continue
        dist[v] = dist[u] + 1
        q.append(v)
seen = {4, 1, 2}
cnt = {"b": 1, "a": 2}
print(*dist[1:])
