#include <bits/stdc++.h>
using namespace std;

long long memo[50];

long long fib(int n) {
    if (n < 2) return n;
    if (memo[n]) return memo[n];
    return memo[n] = fib(n - 1) + fib(n - 2);
}

int main() {
    long long ans = fib(5);
    cout << ans << "\n";
}
