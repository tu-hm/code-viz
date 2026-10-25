def square(x):
    return x * x

n = int(input())
a = [1, 2, 3]
b = a
c = a[:]
b.append(n)
d = {"k": square(n)}
s = "hi"
t = s
for i in range(2):
    a[i] += 10
print(a, b, c, d, t)
