#include <bits/stdc++.h>
using namespace std;

const int N = 7;
vector<int> adj[N];
int dist[N], par[N];

int main() {
    int n, m;
    cin >> n >> m;
    for (int i = 0; i < m; i++) {
        int u, v;
        cin >> u >> v;
        adj[u].push_back(v);
        adj[v].push_back(u);
    }
    fill(dist, dist + N, -1);
    fill(par, par + N, -1);
    queue<int> q;
    dist[1] = 0;
    q.push(1);
    while (!q.empty()) {
        int u = q.front();
        q.pop();
        for (int v : adj[u]) {
            if (dist[v] != -1) continue;
            dist[v] = dist[u] + 1;
            par[v] = u;
            q.push(v);
        }
    }
    for (int i = 1; i <= n; i++) cout << dist[i] << " ";
    cout << "\n";
}
