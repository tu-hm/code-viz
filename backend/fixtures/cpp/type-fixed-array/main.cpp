#include <bits/stdc++.h>
using namespace std;

int main() {
    int a[5] = {5, 4, 3, 2, 1};
    int grid[2][3] = {{1, 2, 3}, {4, 5, 6}};
    array<int, 3> arr = {7, 8, 9};
    array<int, 0> empty;
    array<array<int, 2>, 2> nested = {{{1, 2}, {3, 4}}};
    int *p = &arr[1];
    arr[2] = a[0];
    cout << a[0] + grid[1][2] + arr[2] + empty.size() + nested[1][0] + *p << "\n";
    return 0;
}
