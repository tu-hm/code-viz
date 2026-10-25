#include <bits/stdc++.h>
using namespace std;
int dp[1005][1005];
int main() {
    string s, t; cin >> s >> t;
    int n = s.size(), m = t.size();
    for (int i = 1; i <= n; i++)
        for (int j = 1; j <= m; j++) {
            if (s[i - 1] == t[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
            else dp[i][j] = max(dp[i - 1][j], dp[i][j - 1]);
        }
    cout << dp[n][m] << endl;
}
