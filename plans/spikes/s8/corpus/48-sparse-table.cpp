#include <bits/stdc++.h>
using namespace std;
const int N = 100005, LOG = 17;
int st[LOG][N], lg[N];
int main() {
    int n; cin >> n;
    for (int i = 0; i < n; i++) cin >> st[0][i];
    for (int i = 2; i <= n; i++) lg[i] = lg[i / 2] + 1;
    for (int k = 1; k < LOG; k++)
        for (int i = 0; i + (1 << k) <= n; i++)
            st[k][i] = min(st[k - 1][i], st[k - 1][i + (1 << (k - 1))]);
    int l, r; cin >> l >> r;
    int k = lg[r - l + 1];
    cout << min(st[k][l], st[k][r - (1 << k) + 1]) << '\n';
}
