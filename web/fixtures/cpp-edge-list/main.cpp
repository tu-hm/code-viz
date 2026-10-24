#include <bits/stdc++.h>
using namespace std;

struct Edge { int u, v, w; };

int main() {
    int n = 4;
    vector<pair<int, int>> edges = {{0, 1}, {1, 2}, {2, 3}};
    vector<Edge> roads;
    roads.push_back({0, 1, 5});
    roads.push_back({1, 2, 3});
    roads.push_back({0, 3, 9});
    edges.push_back({3, 0});
    long long total = 0;
    for (auto &e : roads) total += e.w;
    cout << n << " " << total << "\n";
}
