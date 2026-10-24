#include <bits/stdc++.h>
using namespace std;
#define int long long
#define all(x) (x).begin(), (x).end()

struct DSU {
    vector<int> p, sz;
    DSU(int n) : p(n + 1), sz(n + 1, 1) { iota(all(p), 0); }
    int find(int x) { return p[x] == x ? x : p[x] = find(p[x]); }
    bool unite(int a, int b) {
        a = find(a), b = find(b);
        if (a == b) return false;
        if (sz[a] < sz[b]) swap(a, b);
        p[b] = a;
        sz[a] += sz[b];
        return true;
    }
};

struct Edge {
    int u, v, w;
};

signed main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n, m;
    cin >> n >> m;
    vector<Edge> e(m);
    for (auto &[u, v, w] : e) cin >> u >> v >> w;
    sort(all(e), [](const Edge &x, const Edge &y) { return x.w < y.w; });

    DSU d(n);
    int cost = 0, used = 0;
    for (auto [u, v, w] : e) {
        if (d.unite(u, v)) {
            cost += w;
            used++;
        }
    }
    if (used == n - 1)
        cout << cost << "\n";
    else
        cout << "IMPOSSIBLE\n";
}
