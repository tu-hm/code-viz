def countdown(n):
    while n > 0:
        yield n
        n -= 1
    return "done"


total = 0
for v in countdown(3):
    total += v
g = countdown(2)
first = next(g)
rest = list(g)
squares = list(x * x for x in range(3))
print(total, first, rest, squares)
