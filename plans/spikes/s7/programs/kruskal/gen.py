import random
import sys

random.seed(7)
n = int(sys.argv[1]) if len(sys.argv) > 1 else 200_000
m = 2 * n
order = random.sample(range(1, n + 1), n)
edges = [(order[random.randint(0, i - 1)], order[i]) for i in range(1, n)]
edges += [(random.randint(1, n), random.randint(1, n)) for _ in range(m - (n - 1))]
random.shuffle(edges)
print(n, m)
print("\n".join(f"{a} {b} {random.randint(1, 10**9)}" for a, b in edges))
