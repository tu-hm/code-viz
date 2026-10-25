#include <bits/stdc++.h>
using namespace std;
int n; long long bit[200005];
void add(int i, long long v) {
    for (; i <= n; i += i & -i) bit[i] += v;
}
long long sum(int i) {
    long long s = 0;
    for (; i > 0; i -= i & -i) s += bit[i];
    return s;
}
int main() {
    int q; cin >> n >> q;
    for (int i = 1; i <= n; i++) { long long x; cin >> x; add(i, x); }
    while (q--) {
        int l, r; cin >> l >> r;
        cout << sum(r) - sum(l - 1) << "\n";
    }
}
