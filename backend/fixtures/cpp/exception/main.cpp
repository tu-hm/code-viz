#include <bits/stdc++.h>
using namespace std;

int get(const vector<int> &a, int i) {
    return a.at(i);
}

int main() {
    vector<int> a = {1, 2, 3};
    try {
        get(a, 5);
    } catch (const out_of_range &e) {
        cout << "caught: " << e.what() << "\n";
    }
    int total = 0;
    for (int i = 0; i < 4; i++) {
        total += get(a, i);
    }
    cout << total << "\n";
    return 0;
}
