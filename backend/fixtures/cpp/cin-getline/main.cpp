#include <iostream>
#include <string>

int main() {
    int n = 0;
    std::cin >> n;
    long long sum = 0;
    for (int i = 0; i < n; i++) {
        int x = 0;
        std::cin >> x;
        sum += x;
    }
    std::cin.ignore();
    std::string rest;
    std::getline(std::cin, rest);
    std::cout << sum << " " << rest << "\n";
    return 0;
}
