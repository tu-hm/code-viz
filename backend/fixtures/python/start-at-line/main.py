def sum_to(n):
    total = 0
    for i in range(1, n + 1):
        total += i
        if i == 5:
            print("half")
    return total


print("start")
s = sum_to(8)
print(s)
