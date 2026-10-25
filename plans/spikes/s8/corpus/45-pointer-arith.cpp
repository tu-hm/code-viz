#include <bits/stdc++.h>
using namespace std;
int a[100];
int main() {
    int n; cin >> n;
    for (int i = 0; i < n; i++) cin >> *(a + i);
    int *p = a;
    long long s = 0;
    for (int i = 0; i < n; i++) s += p[i] * *(a + i);
    sort(a, a + n);
    cout << s << ' ' << a[n - 1] << '\n';
}
