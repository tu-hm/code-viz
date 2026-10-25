#include <bits/stdc++.h>
using namespace std;
int main() {
    int n; cin >> n;
    vector<int> a(n), d;
    for (int i = 0; i < n; i++) cin >> a[i];
    for (int i = 0; i < n; i++) {
        auto it = lower_bound(d.begin(), d.end(), a[i]);
        if (it == d.end()) d.push_back(a[i]);
        else *it = a[i];
    }
    cout << d.size() << '\n';
}
