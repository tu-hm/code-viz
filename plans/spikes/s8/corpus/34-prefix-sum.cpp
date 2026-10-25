#include <bits/stdc++.h>
using namespace std;
typedef long long ll;
const int N = 200005;
ll a[N], pre[N];
int main() {
    ios::sync_with_stdio(false); cin.tie(nullptr);
    int n, q; cin >> n >> q;
    for (int i = 1; i <= n; i++) cin >> a[i];
    for (int i = 1; i <= n; i++) pre[i] = pre[i - 1] + a[i];
    while (q--) {
        int l, r; cin >> l >> r;
        cout << pre[r] - pre[l - 1] << '\n';
    }
}
