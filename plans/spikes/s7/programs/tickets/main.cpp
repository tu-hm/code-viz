#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n, m;
    cin >> n >> m;
    multiset<int> tickets;
    for (int i = 0; i < n; i++) {
        int h;
        cin >> h;
        tickets.insert(h);
    }
    for (int i = 0; i < m; i++) {
        int t;
        cin >> t;
        auto it = tickets.upper_bound(t);
        if (it == tickets.begin()) {
            cout << -1 << "\n";
            continue;
        }
        --it;
        cout << *it << "\n";
        tickets.erase(it);
    }
}
