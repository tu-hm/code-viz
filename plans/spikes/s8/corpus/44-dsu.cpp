#include <bits/stdc++.h>
using namespace std;
int p[100005], sz[100005];
int find(int x) { return p[x] == x ? x : p[x] = find(p[x]); }
bool unite(int a, int b) {
    a = find(a), b = find(b);
    if (a == b) return false;
    if (sz[a] < sz[b]) swap(a, b);
    p[b] = a; sz[a] += sz[b];
    return true;
}
int main() {
    int n, m; cin >> n >> m;
    for (int i = 1; i <= n; i++) p[i] = i, sz[i] = 1;
    int comps = n;
    while (m--) { int a, b; cin >> a >> b; if (unite(a, b)) comps--; }
    cout << comps << "\n";
}
