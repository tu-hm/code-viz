#include <iostream>

int main() {
    long long total = 0;
    for (int i = 0; i < 2000; i++) {
        total += i;
    }
    std::cout << total << "\n";
    return 0;
}
