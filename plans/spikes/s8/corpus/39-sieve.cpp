#include <bits/stdc++.h>
using namespace std;
const int MAXN = 1000001;
bool composite[MAXN];
vector<int> primes;
int main() {
    int n; scanf("%d", &n);
    for (int i = 2; i <= n; i++) {
        if (!composite[i]) primes.push_back(i);
        for (int j = 0; j < (int)primes.size() && i * primes[j] <= n; j++) {
            composite[i * primes[j]] = true;
            if (i % primes[j] == 0) break;
        }
    }
    printf("%d\n", (int)primes.size());
}
