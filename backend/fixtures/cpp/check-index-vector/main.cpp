#include <bits/stdc++.h>
using namespace std;

int main() {
    vector<int> a = {3, 1, 4, 1, 5};
    int sum = 0;
    for (int i = 0; i <= 5; i++) {
        sum += a[i];
    }
    cout << sum << "\n";
    return 0;
}
