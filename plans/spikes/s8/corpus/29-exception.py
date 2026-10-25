def get(a, i):
    return a[i]


a = [1, 2, 3]
try:
    get(a, 5)
except IndexError as e:
    print("caught:", e)
total = 0
for i in range(4):
    total += get(a, i)
print(total)
