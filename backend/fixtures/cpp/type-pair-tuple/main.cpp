#include <bits/stdc++.h>
using namespace std;

int main() {
    pair<int, string> p = {1, "one"};
    tuple<int, double, string> t = {2, 2.5, "two"};
    vector<pair<int, int>> edges = {{1, 2}, {2, 3}};
    p.first = get<0>(t);
    cout << p.first << " " << edges[1].second << "\n";
    return 0;
}
