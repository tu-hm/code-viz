#include <iostream>

int cnt[10];

void bump(int *arr, int i) {
    arr[i]++;
}

int main() {
    int n = 5;
    bump(cnt, n);
    std::cout << cnt[n] << "\n";
    bump(cnt, n * 100000000);
    std::cout << "unreachable\n";
    return 0;
}
