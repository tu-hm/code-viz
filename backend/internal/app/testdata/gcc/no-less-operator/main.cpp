#include <bits/stdc++.h>
using namespace std;

struct P {
    int x, y;
};

int main() {
    P a[2] = {{2, 1}, {1, 2}};
    sort(a, a + 2);
    map<P, int> seen;
    seen[a[0]] = 1;
    cout << a[0].x << endl;
}
