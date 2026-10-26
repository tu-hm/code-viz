#include <bits/stdc++.h>
using namespace std;
struct Node { int val; Node* next; };
const int MAXN = 200005;
int depth[MAXN];

int main() {
    vector<int> v = {4, 1, 3};
    map<string,int> cnt;
    cnt["ab"] = 2;
    Node* head = new Node{1, nullptr};
    head->next = new Node{2, nullptr};
    depth[3] = 7;
    sort(v.begin(), v.end());
    cout << v[0] << endl;
}
