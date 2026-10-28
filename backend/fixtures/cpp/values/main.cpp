#include <bits/stdc++.h>
using namespace std;

enum Color { RED, GREEN, BLUE };

struct Big {
    long long a, b, c;
};

Big make(const string &name, int k) {
    long long len = name.size();
    Big r = {k, len, 2LL * k};
    return r;
}

int main() {
    float f = 0.1f;
    double d = 2.5;
    char c = 'x';
    Color color = BLUE;
    bool ok = d > f;
    __int128 big = (__int128)1 << 100;
    string word = "Nguyễn";
    string text(1500, 'z');
    Big b = make(word, 7);
    cout << word << " " << b.a + b.b + b.c << " " << (long long)(big >> 90) << ok << c << color << text.size() << "\n";
    return 0;
}
