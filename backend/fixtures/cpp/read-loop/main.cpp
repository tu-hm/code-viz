#include <bits/stdc++.h>
using namespace std;

int main() {
    int n = 0;
    cin >> n;
    int a[n]; memset(a, 0, sizeof a);
    for (int i = n - 1; i >= 0; i--) cin >> a[i];
    long long sum = 0;
    for (int i = 0; i < n; i++) sum += (long long)a[i] * (i + 1);
    cout << n << " " << sum << "\n";
    return 0;
}
