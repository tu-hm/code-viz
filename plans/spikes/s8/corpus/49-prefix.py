import sys
input = sys.stdin.readline
n, q = map(int, input().split())
a = list(map(int, input().split()))
pre = [0] * (n + 1)
for i in range(n):
    pre[i + 1] = pre[i] + a[i]
out = []
for _ in range(q):
    l, r = map(int, input().split())
    out.append(pre[r] - pre[l - 1])
print("\n".join(map(str, out)))
