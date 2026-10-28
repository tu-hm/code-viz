#include <iostream>

struct Counter {
    int n;
    Counter(int start) : n(start) {}
    void bump(int by) {
        n += by;
    }
    ~Counter() {
        std::cout << "bye " << n << "\n";
    }
};

int main() {
    int r = 0;
    {
        Counter *c = new Counter(5);
        c->bump(2);
        auto twice = [](int x) { return 2 * x; };
        r = twice(c->n);
        delete c;
    }
    std::cout << r << "\n";
    return 0;
}
