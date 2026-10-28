#include <bits/stdc++.h>
using namespace std;

int check(int x) {
    if (x > 2) {
        throw runtime_error("too big");
    }
    return x * 10;
}

int deeper(int x) {
    string tag = "deeper";
    int y = check(x);
    return y + 1;
}

int main() {
    int total = deeper(1);
    try {
        total += deeper(5);
    } catch (const exception &e) {
        total = -total;
    }
    cout << total << "\n";
    return 0;
}
