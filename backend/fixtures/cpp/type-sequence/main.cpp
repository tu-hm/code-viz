#include <bits/stdc++.h>
using namespace std;

int main() {
    vector<int> v = {3, 1, 2};
    v.reserve(10);
    vector<bool> flags = {true, false, true};
    vector<string> words = {"a", "bc"};
    deque<int> dq = {1, 2, 3};
    dq.push_front(0);
    list<int> li = {4, 5, 6};
    li.pop_back();
    cout << v.size() + flags.size() + words.size() + dq.size() + li.size() << "\n";
    return 0;
}
