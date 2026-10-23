#include <iostream>

int fib(int n) {
    if (n < 2) {
        return n;
    }
    return fib(n - 1) + fib(n - 2);
}

int main() {
    int r = fib(4);
    std::cout << r << "\n";
    return 0;
}
