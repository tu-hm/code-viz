#include <bits/stdc++.h>
using namespace std;
const int N = 1 << 17;
int t[2 * N];
void update(int p, int v) {
    for (t[p += N] = v; p > 1; p >>= 1) t[p >> 1] = t[p] + t[p ^ 1];
}
int query(int l, int r) {
    int res = 0;
    for (l += N, r += N; l < r; l >>= 1, r >>= 1) {
        if (l & 1) res += t[l++];
        if (r & 1) res += t[--r];
    }
    return res;
}
int main() {
    int n; cin >> n;
    for (int i = 0; i < n; i++) { int x; cin >> x; update(i, x); }
    cout << query(0, n) << "\n";
}
