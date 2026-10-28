import random
import sys

random.seed(7)
n = int(sys.argv[1]) if len(sys.argv) > 1 else 100_000
print("".join(random.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(n)))
