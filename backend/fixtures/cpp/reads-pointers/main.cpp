#include <bits/stdc++.h>
using namespace std;
struct Job { int s, e; };
int a[6] = {5, 1, 4, 2, 8, 3};
int main() {
    vector<Job> jobs = {{1, 3}, {2, 5}};
    int *p = &a[1];
    int sum = *(a + 2) + p[2];
    int len = jobs[1].e - jobs[0].s;
    int b[4] = {7, 8, 9, 10};
    array<int, 3> c = {4, 5, 6};
    int k = 1;
    sum += b[k] + b[0] + c[k] + c[0];
    vector<vector<long long>> dp(3, vector<long long>(4, 1));
    for (int i = 1; i < 3; i++)
        for (int j = 1; j < 4; j++)
            dp[i][j] = dp[i - 1][j] + dp[i][j - 1];
    cout << sum << " " << len << " " << dp[2][3] << "\n";
}
