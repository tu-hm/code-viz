#include <bits/stdc++.h>
using namespace std;

struct Shape {
    int sides;
    static int made;
    virtual int area() { return 0; }
};

int Shape::made = 0;

struct Square : Shape {
    int sides;
    int len;
    int area() override { return len * len; }
};

struct Cell {
    int kind;
    union {
        int i;
        float f;
    };
};

struct Grid : vector<int> {
    int width;
};

int main() {
    Square sq{};
    sq.Shape::sides = 4;
    sq.sides = 4;
    sq.len = 3;
    Cell c = {1, {7}};
    Grid g{};
    g.width = 2;
    g.push_back(1);
    cout << sq.area() + c.i + g.width << "\n";
    return 0;
}
