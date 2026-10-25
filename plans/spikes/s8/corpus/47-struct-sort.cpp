#include <bits/stdc++.h>
using namespace std;
struct Job { int s, e; };
int main() {
    int n; cin >> n;
    vector<Job> v(n);
    for (int i = 0; i < n; i++) cin >> v[i].s >> v[i].e;
    sort(v.begin(), v.end(), [](const Job &a, const Job &b) { return a.e < b.e; });
    int cnt = 0, last = INT_MIN;
    for (int i = 0; i < n; i++)
        if (v[i].s >= last) { cnt++; last = v[i].e; }
    cout << cnt << endl;
}
