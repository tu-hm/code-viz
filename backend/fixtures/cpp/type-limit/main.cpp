#include <bits/stdc++.h>
using namespace std;

int main() {
    vector<int> keys;
    keys.resize(150);
    iota(keys.begin(), keys.end(), 0);
    set<int> s(keys.begin(), keys.end());
    deque<int> dq(keys.begin(), keys.end());
    vector<string> words;
    words.assign(150, "w");
    vector<pair<int, int>> pairs;
    pairs.resize(150);
    multimap<int, int> m(pairs.begin(), pairs.end());
    cout << s.size() + dq.size() + words.size() + m.size() << "\n";
    return 0;
}
