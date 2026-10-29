#include <bits/stdc++.h>
using namespace std;

int dist[100005];

int main() {
    memset(dist, 0x3f, sizeof dist);
    dist[1] = 0;
    dist[2] = 5;
    vector<int> cnt;
    cnt.resize(100);
    cnt[7] = 3;
    cnt.push_back(9);
    bool seen[80] = {};
    seen[4] = true;
    double w[70] = {};
    w[2] = 0.5;
    cout << dist[2] + cnt[7] + seen[4] + w[2] << "\n";
    return 0;
}
