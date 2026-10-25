#include <bits/stdc++.h>
using namespace std;

long long big[1000000];
int a[20000];

int main() {
    big[3] = 7;
    big[500000] = 1;
    iota(a, a + 20000, 1);
    a[5] = 0;
    cout << big[3] + a[5] << "\n";
    return 0;
}
