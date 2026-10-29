#include <bits/stdc++.h>
using namespace std;

int main() {
    set<int> s = {1};
    s.erase(1);
    int smallest = *s.begin();
    cout << smallest << "\n";
    return 0;
}
