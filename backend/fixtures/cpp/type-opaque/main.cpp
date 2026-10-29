#include <bits/stdc++.h>
using namespace std;

int main() {
    optional<int> maybe = 3;
    unique_ptr<int> owned = make_unique<int>(4);
    set<int> s = {1, 2};
    auto it = s.begin();
    complex<double> z(1.0, 2.0);
    mt19937 rng(42);
    cout << *maybe + *owned + *it + (int)z.real() + (rng() > 0) << "\n";
    return 0;
}
