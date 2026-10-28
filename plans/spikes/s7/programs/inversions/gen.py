import random
import sys

random.seed(7)
n = int(sys.argv[1]) if len(sys.argv) > 1 else 200_000
print(n)
print(" ".join(str(random.randint(1, 10**9)) for _ in range(n)))
