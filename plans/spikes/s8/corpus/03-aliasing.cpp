#include <bits/stdc++.h>
using namespace std;

int square(int x) {
    return x * x;
}

int main() {
    int n = 0;
    cin >> n;
    vector<int> a = {1, 2, 3};
    vector<int> &b = a;
    vector<int> c = a;
    b.push_back(n);
    map<string, int> d = {{"k", square(n)}};
    string s = "hi";
    string t = s;
    for (int i = 0; i < 2; i++) {
        a[i] += 10;
    }
    cout << a[0] << " " << b[0] << " " << c[0] << " " << d["k"] << " " << t << "\n";
    return 0;
}
