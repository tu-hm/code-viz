import random
import sys

random.seed(7)
n = int(sys.argv[1]) if len(sys.argv) > 1 else 200_000
label = list(range(1, n + 1))
random.shuffle(label)
edges = []
for i in range(1, n):
    p = random.randint(max(0, i - 10), i - 1)
    a, b = label[p], label[i]
    edges.append((a, b) if random.random() < 0.5 else (b, a))
random.shuffle(edges)
print(n)
print("\n".join(f"{a} {b}" for a, b in edges))
