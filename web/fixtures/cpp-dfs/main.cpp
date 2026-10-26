#include <bits/stdc++.h>
using namespace std;

const int N = 8;
vector<int> adj[N];
bool vis[N];

void dfs(int u) {
    vis[u] = true;
    for (int v : adj[u])
        if (!vis[v]) dfs(v);
}

int main() {
    int edges[][2] = {{1, 2}, {1, 3}, {2, 4}, {3, 4}, {4, 5}, {2, 6}, {6, 7}};
    for (auto &e : edges) {
        adj[e[0]].push_back(e[1]);
        adj[e[1]].push_back(e[0]);
    }
    dfs(1);
    cout << count(vis, vis + N, true) << "\n";
}
