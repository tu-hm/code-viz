#include <bits/stdc++.h>
using namespace std;

const int N = 200005;
vector<int> adj[N];
int depth[N], sz[N];
bool vis[N];

void dfs(int u) {
    vis[u] = true;
    sz[u] = 1;
    for (int v : adj[u]) {
        if (vis[v]) continue;
        depth[v] = depth[u] + 1;
        dfs(v);
        sz[u] += sz[v];
    }
}

int main() {
    int n;
    scanf("%d", &n);
    for (int i = 1; i < n; i++) {
        int a, b;
        scanf("%d %d", &a, &b);
        adj[a].push_back(b);
        adj[b].push_back(a);
    }
    dfs(1);
    long long total = 0;
    for (int i = 1; i <= n; i++) total += depth[i];
    printf("%lld\n", total);
    return 0;
}
