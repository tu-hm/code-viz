#pragma GCC optimize("O3,unroll-loops")
#include <bits/stdc++.h>
using namespace std;
using ll = long long;

const int MAXN = 2e5 + 5;
int n, q;
ll t[4 * MAXN], a[MAXN];

void build(int v, int tl, int tr) {
    if (tl == tr) {
        t[v] = a[tl];
        return;
    }
    int tm = (tl + tr) / 2;
    build(2 * v, tl, tm);
    build(2 * v + 1, tm + 1, tr);
    t[v] = min(t[2 * v], t[2 * v + 1]);
}

void update(int v, int tl, int tr, int pos, ll val) {
    if (tl == tr) {
        t[v] = val;
        return;
    }
    int tm = (tl + tr) / 2;
    if (pos <= tm)
        update(2 * v, tl, tm, pos, val);
    else
        update(2 * v + 1, tm + 1, tr, pos, val);
    t[v] = min(t[2 * v], t[2 * v + 1]);
}

ll query(int v, int tl, int tr, int l, int r) {
    if (l > r) return LLONG_MAX;
    if (l == tl && r == tr) return t[v];
    int tm = (tl + tr) / 2;
    return min(query(2 * v, tl, tm, l, min(r, tm)), query(2 * v + 1, tm + 1, tr, max(l, tm + 1), r));
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    cin >> n >> q;
    for (int i = 1; i <= n; i++) cin >> a[i];
    build(1, 1, n);
    while (q--) {
        int type;
        cin >> type;
        if (type == 1) {
            int k;
            ll u;
            cin >> k >> u;
            update(1, 1, n, k, u);
        } else {
            int l, r;
            cin >> l >> r;
            cout << query(1, 1, n, l, r) << '\n';
        }
    }
}
