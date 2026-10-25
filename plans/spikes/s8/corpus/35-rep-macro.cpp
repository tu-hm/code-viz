#include <bits/stdc++.h>
using namespace std;
#define rep(i, a, b) for (int i = (a); i < (b); i++)
int n, a[1005], cnt[1005];
int main() {
    cin >> n;
    rep(i, 0, n) cin >> a[i];
    rep(i, 0, n) cnt[a[i]]++;
    int best = 0;
    rep(v, 0, 1001) if (cnt[v] > cnt[best]) best = v;
    cout << best << endl;
}
