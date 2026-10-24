#include <bits/stdc++.h>
using namespace std;

struct Item {
    string name;
    int weight;
};

int main() {
    vector<Item> items;
    items.push_back({"pen", 2});
    items.push_back({"book", 5});
    Item first = items[0];
    auto heavier = [first](const Item &x) { return x.weight > first.weight; };
    bool more = heavier(items[1]);
    cout << more << "\n";
    return 0;
}
