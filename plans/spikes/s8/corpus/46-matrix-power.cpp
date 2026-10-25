#include <bits/stdc++.h>
using namespace std;
typedef vector<vector<long long>> Mat;
const long long MOD = 1e9 + 7;
Mat mul(const Mat &A, const Mat &B) {
    int n = A.size();
    Mat C(n, vector<long long>(n, 0));
    for (int i = 0; i < n; i++)
        for (int k = 0; k < n; k++)
            for (int j = 0; j < n; j++)
                C[i][j] = (C[i][j] + A[i][k] * B[k][j]) % MOD;
    return C;
}
int main() {
    Mat F = {{1, 1}, {1, 0}}, R = {{1, 0}, {0, 1}};
    long long n; cin >> n;
    while (n) { if (n & 1) R = mul(R, F); F = mul(F, F); n >>= 1; }
    cout << R[0][1] << "\n";
}
