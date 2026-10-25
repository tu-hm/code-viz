#include <bits/stdc++.h>
using namespace std;

const int N = 200005;
long long a[N], pre[N];

int main() {
    int n = 200000;
    for (int i = 1; i <= n; i++) {
        a[i] = 1LL * i * i % 1000003;
        pre[i] = pre[i - 1] + a[i];
    }
    printf("%lld\n", pre[n]);
    return 0;
}
