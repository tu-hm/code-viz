#include <cstdio>
#include <iostream>

static const int viz_flush_init = [] {
    std::setvbuf(stdout, nullptr, _IONBF, 0);
    std::cout << std::unitbuf;
    return 0;
}();
