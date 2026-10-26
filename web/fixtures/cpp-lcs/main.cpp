#include <bits/stdc++.h>
using namespace std;

const int INF = 0x3f3f3f3f;
const int MOD = 1e9 + 7;

int main() {
    string s = "abcb", t = "bdcb";
    int n = s.size(), m = t.size();
    vector<vector<int>> dp(n + 1, vector<int>(m + 1, 0));
    for (int i = 1; i <= n; i++)
        for (int j = 1; j <= m; j++)
            dp[i][j] = s[i - 1] == t[j - 1] ? dp[i - 1][j - 1] + 1 : max(dp[i - 1][j], dp[i][j - 1]);
    int best = INF, top = INT_MAX;
    long long ways = dp[n][m] % MOD, cap = LLONG_MAX;
    cout << dp[n][m] << " " << best << " " << top << " " << ways << " " << cap << "\n";
}
