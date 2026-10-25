#include <bits/stdc++.h>
using namespace std;

int dist[20005];

int main() {
    generate(dist, dist + 20005, rand);
    vector<string> names(300, "x");
    names[250] = "far";
    int x = dist[15003] % 100;
    cout << x << " " << names[250] << "\n";
    return 0;
}
