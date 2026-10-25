n = int(input())
names = []
for _ in range(n):
    names.append(input())
x, y = map(int, input().split())
print(len(names), x + y)
print(" ".join(reversed(names)))
