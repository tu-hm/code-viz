t = [i * i for i in range(8)]
w = [2, 3]
dp = [0] * 6
p = 5
s = t[p ^ 1] + t[p >> 1]
for i in range(2):
    for c in range(5, w[i] - 1, -1):
        dp[c] = max(dp[c], dp[c - w[i]] + 1)
l, total = 0, 0
while l < 3:
    total += t[l]
    l += 1
grid = [[1, 2, 3], [4, 5, 6]]
x = grid[1][2] + grid[0][-1]
print(s, dp[5], total, x)
