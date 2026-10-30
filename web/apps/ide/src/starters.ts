export type Draft = { code: string; stdin: string }

const starters = new Map<string, Draft>([
  [
    'python3',
    {
      code: `def square(x):
    return x * x

n = int(input())
a = [1, 2, 3]
b = a
c = a[:]
b.append(n)
d = {"k": square(n)}
s = "hi"
t = s
for i in range(2):
    a[i] += 10
print(a, b, c, d, t)
`,
      stdin: '5\n',
    },
  ],
  [
    'cpp17-gcc',
    {
      code: `#include <bits/stdc++.h>
using namespace std;
int main() {
    int n, x; cin >> n >> x;
    vector<int> a(n);
    for (auto &v : a) cin >> v;
    int l = 0, r = n - 1, ans = -1;
    while (l <= r) {
        int mid = (l + r) / 2;
        if (a[mid] >= x)
            ans = mid, r = mid - 1;
        else
            l = mid + 1;
    }
    cout << ans << "\\n";
}
`,
      stdin: '8 13\n1 3 5 7 9 11 13 15\n',
    },
  ],
])

export function starter(languageId: string): Draft {
  return starters.get(languageId) ?? { code: '', stdin: '' }
}
