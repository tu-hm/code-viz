def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)


def bubble(a):
    n = len(a)
    for i in range(n):
        for j in range(n - 1 - i):
            if a[j] > a[j + 1]:
                a[j], a[j + 1] = a[j + 1], a[j]
    return a


data = [9, 4, 7, 1, 8, 2, 6, 3, 5, 0, 11, 10]
counts = {}
for x in data:
    counts[x % 3] = counts.get(x % 3, 0) + 1
bubble(data)
f = fib(11)
print(f, data, counts)
