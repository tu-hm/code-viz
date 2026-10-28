#include <bits/stdc++.h>
using namespace std;

template <class T> bool chmax(T &a, const T &b) { if (a < b) { a = b; return true; } return false; }
void add(int &x, int v) { x += v; }

int main() {
    vector<int> v = {3, 1, 2};
    sort(v.begin(), v.end(), [](int a, int b) { return a > b; });
    int best = 1;
    chmax(best, v[0]);
    chmax(best, 2);
    add(best, 10);
    cout << best << "\n";
    return 0;
}
