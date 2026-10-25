#include <bits/stdc++.h>
using namespace std;

int main() {
    int n = 0;
    cin >> n;
    vector<string> names;
    for (int i = 0; i < n; i++) {
        string name;
        cin >> name;
        names.push_back(name);
    }
    int x = 0;
    int y = 0;
    cin >> x >> y;
    cout << names.size() << " " << x + y << "\n";
    for (int i = n - 1; i >= 0; i--) {
        cout << names[i] << (i > 0 ? " " : "\n");
    }
    return 0;
}
