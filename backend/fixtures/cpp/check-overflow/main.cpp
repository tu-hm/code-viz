#include <bits/stdc++.h>
using namespace std;

int main() {
    vector<int> a = {2000000000, 1000000000};
    int sum = 0;
    for (int x : a) {
        sum += x;
    }
    cout << sum << "\n";
    return 0;
}
