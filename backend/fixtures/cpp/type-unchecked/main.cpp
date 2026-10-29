#include <bits/stdc++.h>
using namespace std;

int main() {
    vector<int> v = {1, 2};
    list<int> li = {3};
    set<int> s = {4};
    map<int, int> m = {{5, 6}};
    unordered_map<int, int> um = {{7, 8}};
    string name = "off";
    cout << v.size() + li.size() + s.size() + m.size() + um.size() << name << "\n";
    return 0;
}
