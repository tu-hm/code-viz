#include <bits/stdc++.h>
using namespace std;

int main() {
    map<string, int> m = {{"a", 1}, {"b", 2}};
    multimap<int, int> mm = {{1, 2}, {1, 3}};
    unordered_map<int, int> um = {{1, 10}, {2, 20}};
    unordered_multimap<int, int> umm = {{7, 1}, {7, 2}};
    m["c"] = 3;
    cout << m.size() + mm.size() + um.size() + umm.size() << "\n";
    return 0;
}
