#include <bits/stdc++.h>
using namespace std;
int main() {
    int n; long long k; cin >> n >> k;
    vector<long long> a(n);
    for (auto &x : a) cin >> x;
    long long sum = 0; int best = 0;
    for (int l = 0, r = 0; r < n; r++) {
        sum += a[r];
        while (sum > k) sum -= a[l++];
        best = max(best, r - l + 1);
    }
    cout << best << '\n';
}
