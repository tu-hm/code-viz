#include <bits/stdc++.h>
using namespace std;
#define int long long
#define all(x) (x).begin(), (x).end()

struct Fenwick {
    int n;
    vector<int> f;
    Fenwick(int n) : n(n), f(n + 1, 0) {}
    void add(int i, int v) {
        for (; i <= n; i += i & -i) f[i] += v;
    }
    int sum(int i) {
        int s = 0;
        for (; i > 0; i -= i & -i) s += f[i];
        return s;
    }
};

signed main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    cin >> n;
    vector<int> a(n);
    for (auto &x : a) cin >> x;

    vector<int> vals = a;
    sort(all(vals));
    vals.erase(unique(all(vals)), vals.end());

    Fenwick bit(vals.size());
    int inv = 0;
    for (int i = n - 1; i >= 0; i--) {
        int k = lower_bound(all(vals), a[i]) - vals.begin() + 1;
        inv += bit.sum(k - 1);
        bit.add(k, 1);
    }
    cout << inv << "\n";
}
