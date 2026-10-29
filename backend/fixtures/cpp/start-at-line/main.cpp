#include <bits/stdc++.h>
using namespace std;

int sum_to(int n) {
    int total = 0;
    for (int i = 1; i <= n; i++) {
        total += i;
        if (i == 5) {
            cout << "half" << "\n";
        }
    }
    return total;
}

int main() {
    cout << "start" << "\n";
    int s = sum_to(8);
    cout << s << "\n";
    return 0;
}
