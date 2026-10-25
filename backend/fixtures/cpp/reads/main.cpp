#include <bits/stdc++.h>
using namespace std;
int t[8];
int main() {
    vector<int> w = {2, 3};
    vector<long long> dp(6);
    for (int i = 0; i < 8; i++) t[i] = i * i;
    int p = 5;
    int s = t[p ^ 1] + t[p >> 1];
    for (int i = 0; i < 2; i++)
        for (int c = 5; c >= w[i]; c--)
            dp[c] = max(dp[c], dp[c - w[i]] + 1);
    int l = 0, total = 0;
    while (l < 3) total += t[l++];
    vector<vector<int>> grid = {{1, 2, 3}, {4, 5, 6}};
    int x = grid[1][2] + grid[0][2];
    cout << s << " " << dp[5] << " " << total << " " << x << "\n";
}
