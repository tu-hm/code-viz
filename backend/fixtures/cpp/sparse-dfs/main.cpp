#include <bits/stdc++.h>
using namespace std;

const int N = 200005;
int depth_[N];
int tin[N];
int timer_ = 0;
int n = 200000;

void dfs(int u, int d) {
    if (u > n || timer_ == 6) return;
    depth_[u] = d;
    tin[u] = ++timer_;
    int child = 2 * u;
    dfs(child, d + 1);
    dfs(child + 1, d + 1);
}

int main() {
    dfs(1, 0);
    cout << timer_ << "\n";
    return 0;
}
