#include <bits/stdc++.h>
using namespace std;

const int N = 200005;
int n = 200000;
int depth[N], tin[N];
int timer_;

void dfs(int u, int d) {
    depth[u] = d;
    tin[u] = ++timer_;
    if (2 * u <= n) dfs(2 * u, d + 1);
    if (2 * u + 1 <= n) dfs(2 * u + 1, d + 1);
}

int main() {
    dfs(1, 0);
    printf("%d\n", timer_);
    return 0;
}
