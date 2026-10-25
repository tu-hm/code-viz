n, m = map(int, input().split())
g = [input() for _ in range(n)]
dp = [[0] * m for _ in range(n)]
dp[0][0] = 1
for i in range(n):
    for j in range(m):
        if g[i][j] == '#':
            dp[i][j] = 0
            continue
        if i > 0:
            dp[i][j] += dp[i - 1][j]
        if j > 0:
            dp[i][j] += dp[i][j - 1]
print(dp[n - 1][m - 1] % (10**9 + 7))
