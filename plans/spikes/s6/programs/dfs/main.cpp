#include <bits/stdc++.h>
using namespace std;

const int N = 200005;
int n = 200000;
int a[N];
int timer_;

void dfs(int u) {
    a[u] = ++timer_;
    if (2 * u <= n) dfs(2 * u);
    if (2 * u + 1 <= n) dfs(2 * u + 1);
}

int main() {
    dfs(1);
    printf("%d\n", timer_);
    return 0;
}
