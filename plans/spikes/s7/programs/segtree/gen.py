import random
import sys

random.seed(7)
n = q = int(sys.argv[1]) if len(sys.argv) > 1 else 200_000
lines = [f"{n} {q}", " ".join(str(random.randint(1, 10**9)) for _ in range(n))]
for _ in range(q):
    if random.random() < 0.5:
        lines.append(f"1 {random.randint(1, n)} {random.randint(1, 10**9)}")
    else:
        l, r = sorted((random.randint(1, n), random.randint(1, n)))
        lines.append(f"2 {l} {r}")
print("\n".join(lines))
