#include <bits/stdc++.h>
using namespace std;
using ll = long long;

const ll M1 = 1e9 + 7, M2 = 1e9 + 9, B = 131;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    string s;
    cin >> s;
    int n = s.size();
    vector<ll> h1(n + 1), h2(n + 1), p1(n + 1), p2(n + 1);
    p1[0] = p2[0] = 1;
    for (int i = 0; i < n; i++) {
        h1[i + 1] = (h1[i] * B + s[i]) % M1;
        h2[i + 1] = (h2[i] * B + s[i]) % M2;
        p1[i + 1] = p1[i] * B % M1;
        p2[i + 1] = p2[i] * B % M2;
    }
    auto get = [&](int l, int len) {
        ll a = ((h1[l + len] - h1[l] * p1[len]) % M1 + M1) % M1;
        ll b = ((h2[l + len] - h2[l] * p2[len]) % M2 + M2) % M2;
        return a * M2 + b;
    };
    auto find = [&](int len) {
        vector<pair<ll, int>> v;
        for (int i = 0; i + len <= n; i++) v.push_back({get(i, len), i});
        sort(v.begin(), v.end());
        for (int i = 1; i < (int)v.size(); i++)
            if (v[i].first == v[i - 1].first) return v[i].second;
        return -1;
    };

    int lo = 1, hi = n - 1, best = -1, at = -1;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        int p = find(mid);
        if (p != -1) {
            best = mid, at = p;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    if (best == -1)
        cout << -1 << "\n";
    else
        cout << s.substr(at, best) << "\n";
}
