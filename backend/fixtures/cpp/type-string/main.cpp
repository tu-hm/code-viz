#include <bits/stdc++.h>
using namespace std;

int main() {
    string s = "hello";
    string_view view = s;
    const char *lit = "literal";
    char buf[8] = "abc";
    const char *fromBuf = buf;
    char *raw = buf;
    const char *none = nullptr;
    const char *bad = (const char *)0x10;
    string longStr(1500, 'x');
    const char *longLit = longStr.c_str();
    cout << s << view << "\n";
    cout << lit << fromBuf << raw << "\n";
    cout << longLit[0] << (const void *)none << (const void *)bad << "\n";
    return 0;
}
