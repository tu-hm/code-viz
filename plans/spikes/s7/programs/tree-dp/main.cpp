#include <bits/stdc++.h>
using namespace std;
#define int long long
#define all(x) (x).begin(), (x).end()

const int N = 2e5 + 5;
vector<int> adj[N];
int sz[N], down_[N], ans[N];
int n;

signed main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    cin >> n;
    for (int i = 0; i < n - 1; i++) {
        int a, b;
        cin >> a >> b;
        adj[a].push_back(b);
        adj[b].push_back(a);
    }

    auto dfs1 = [&](auto &&self, int u, int p) -> void {
        sz[u] = 1;
        for (int v : adj[u]) {
            if (v == p) continue;
            self(self, v, u);
            sz[u] += sz[v];
            down_[u] += down_[v] + sz[v];
        }
    };
    auto dfs2 = [&](auto &&self, int u, int p) -> void {
        for (int v : adj[u]) {
            if (v == p) continue;
            ans[v] = ans[u] - sz[v] + (n - sz[v]);
            self(self, v, u);
        }
    };

    dfs1(dfs1, 1, 0);
    ans[1] = down_[1];
    dfs2(dfs2, 1, 0);
    for (int i = 1; i <= n; i++) cout << ans[i] << " \n"[i == n];
}
