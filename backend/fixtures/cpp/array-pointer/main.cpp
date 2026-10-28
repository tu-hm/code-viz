#include <iostream>

int *cursor;

int main() {
    int a[5] = {10, 20, 30, 40, 50};
    int total = 0;
    for (cursor = a + 2; cursor != a + 5; cursor++) {
        total += *cursor;
    }
    std::cout << total << "\n";
    return 0;
}
