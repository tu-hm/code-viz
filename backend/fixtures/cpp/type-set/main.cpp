#include <bits/stdc++.h>
using namespace std;

int main() {
    set<int> s = {3, 1, 2};
    multiset<int> ms = {1, 1, 2};
    unordered_set<int> us = {10, 20, 30};
    unordered_multiset<int> ums = {5, 5};
    s.erase(1);
    cout << s.size() + ms.size() + us.size() + ums.size() << "\n";
    return 0;
}
