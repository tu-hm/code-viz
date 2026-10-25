#include <bits/stdc++.h>
using namespace std;

struct Point {
    int x;
    int y;
};

int grid[3][4];

int main() {
    vector<int> v = {3, 1, 2};
    sort(v.begin(), v.end());
    map<string, int> count;
    count["a"] = 1;
    count["b"] = 2;
    string name = "viz";
    Point p = {1, 2};
    Point *q = &p;
    grid[1][2] = 7;
    cout << v[0] << " " << name << " " << q->x << "\n";
    return 0;
}
