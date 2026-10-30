import random

dist = list(range(3000))
random.shuffle(dist)
names = ["x"] * 1500
names[1200] = "far"
x = dist[2500] % 100
print(x, names[1200])
