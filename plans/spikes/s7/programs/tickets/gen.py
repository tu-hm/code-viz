import random
import sys

random.seed(7)
n = m = int(sys.argv[1]) if len(sys.argv) > 1 else 200_000
print(n, m)
print(" ".join(str(random.randint(1, 10**9)) for _ in range(n)))
print(" ".join(str(random.randint(1, 10**9)) for _ in range(m)))
