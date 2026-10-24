import random
import sys

random.seed(7)
n = m = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
g = [["#" if random.random() < 0.3 else "." for _ in range(m)] for _ in range(n)]
r = c = 0
while (r, c) != (n - 1, m - 1):
    g[r][c] = "."
    if c == m - 1 or (r < n - 1 and random.random() < 0.5):
        r += 1
    else:
        c += 1
g[0][0], g[n - 1][m - 1] = "A", "B"
print(n, m)
print("\n".join("".join(row) for row in g))
