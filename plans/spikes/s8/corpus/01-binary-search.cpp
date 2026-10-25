#include <bits/stdc++.h>
using namespace std;

int binary_search(const vector<int> &a, int target) {
    int lo = 0;
    int hi = (int)a.size() - 1;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        if (a[mid] == target) {
            return mid;
        }
        if (a[mid] < target) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return -1;
}

int main() {
    vector<int> a = {1, 3, 5, 7, 9, 11, 13, 15};
    cout << binary_search(a, 11) << "\n";
    cout << binary_search(a, 4) << "\n";
    return 0;
}
