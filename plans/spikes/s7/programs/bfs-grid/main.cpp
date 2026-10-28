#include <algorithm>
#include <iostream>
#include <queue>
#include <string>
#include <vector>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n, m;
    cin >> n >> m;
    vector<string> g(n);
    for (auto &row : g) cin >> row;

    int sr = 0, sc = 0, er = 0, ec = 0;
    for (int i = 0; i < n; i++) {
        for (int j = 0; j < m; j++) {
            if (g[i][j] == 'A') sr = i, sc = j;
            if (g[i][j] == 'B') er = i, ec = j;
        }
    }

    const int dr[] = {-1, 1, 0, 0}, dc[] = {0, 0, -1, 1};
    const char dir[] = "UDLR";
    vector<vector<int>> from(n, vector<int>(m, -1));
    queue<pair<int, int>> q;
    q.push({sr, sc});
    from[sr][sc] = 4;
    while (!q.empty()) {
        auto [r, c] = q.front();
        q.pop();
        for (int k = 0; k < 4; k++) {
            int nr = r + dr[k], nc = c + dc[k];
            if (nr < 0 || nr >= n || nc < 0 || nc >= m) continue;
            if (g[nr][nc] == '#' || from[nr][nc] != -1) continue;
            from[nr][nc] = k;
            q.push({nr, nc});
        }
    }

    if (from[er][ec] == -1) {
        cout << "NO\n";
        return 0;
    }
    string path;
    for (int r = er, c = ec; r != sr || c != sc;) {
        int k = from[r][c];
        path += dir[k];
        r -= dr[k], c -= dc[k];
    }
    reverse(path.begin(), path.end());
    cout << "YES\n" << path.size() << "\n" << path << "\n";
}
