#include <iostream>

int dive(int n) {
    int pad[1 << 23];
    pad[0] = n;
    return dive(n + 1) + pad[0];
}

int main() {
    std::cout << dive(0) << "\n";
    return 0;
}
