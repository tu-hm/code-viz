#include <bits/stdc++.h>
using namespace std;

void dfs(int v, vector<vector<int>> &adj, vector<bool> &seen) {
    seen[v] = true;
    for (int u : adj[v]) {
        if (!seen[u]) {
            dfs(u, adj, seen);
        }
    }
}

void solve() {
    int n = 0;
    cin >> n;
    vector<vector<int>> adj;
    adj.resize(n);
    for (int i = 0; i < n - 1; i++) {
        int a = 0;
        int b = 0;
        cin >> a >> b;
        adj[a].push_back(b);
        adj[b].push_back(a);
    }
    vector<bool> seen;
    seen.resize(n);
    dfs(0, adj, seen);
    cout << count(seen.begin(), seen.end(), true) << "\n";
}

int main() {
    solve();
    return 0;
}
