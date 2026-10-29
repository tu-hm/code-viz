#include <bits/stdc++.h>
using namespace std;

int main() {
    bitset<10> small(5);
    bitset<70> wide;
    wide.set(1);
    wide.set(65);
    cout << small.count() + wide.count() << "\n";
    return 0;
}
