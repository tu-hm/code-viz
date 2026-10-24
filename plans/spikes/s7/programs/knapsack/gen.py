import random

random.seed(7)
n, x = 1000, 100_000
print(n, x)
print(" ".join(str(random.randint(1, 1000)) for _ in range(n)))
print(" ".join(str(random.randint(1, 1000)) for _ in range(n)))
