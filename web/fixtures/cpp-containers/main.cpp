#include <bits/stdc++.h>
using namespace std;

int main() {
    stack<int> st;
    for (int x : {5, 3, 8}) st.push(x);
    deque<int> q = {4, 7};
    q.push_back(1);
    priority_queue<int> pq;
    for (int x : {5, 9, 2, 7}) pq.push(x);
    map<string, int> cnt;
    cnt["ab"] = 2;
    cnt["cd"] = 1;
    multiset<int> ms = {5, 2, 5, 5};
    set<int> seen = {3, 1};
    int mask = 0;
    for (int b : {0, 2, 3, 5}) mask |= 1 << b;
    cout << st.top() << " " << q.front() << " " << pq.top() << " " << mask << "\n";
}
