#include <bits/stdc++.h>
using namespace std;

int main() {
    stack<int> st;
    st.push(1);
    st.push(2);
    stack<int, vector<int>> vst;
    vst.push(3);
    queue<int> q;
    q.push(4);
    q.push(5);
    priority_queue<int> pq;
    pq.push(5);
    pq.push(9);
    pq.push(7);
    cout << st.top() + vst.top() + q.front() + pq.top() << "\n";
    return 0;
}
