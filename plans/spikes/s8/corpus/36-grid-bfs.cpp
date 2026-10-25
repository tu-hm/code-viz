#include <bits/stdc++.h>
using namespace std;
int n, m;
char g[505][505];
int dist[505][505];
int dx[] = {1, -1, 0, 0}, dy[] = {0, 0, 1, -1};
int main() {
    cin >> n >> m;
    for (int i = 0; i < n; i++) cin >> g[i];
    memset(dist, -1, sizeof dist);
    queue<pair<int, int>> q;
    q.push({0, 0}); dist[0][0] = 0;
    while (!q.empty()) {
        auto [x, y] = q.front(); q.pop();
        for (int d = 0; d < 4; d++) {
            int nx = x + dx[d], ny = y + dy[d];
            if (nx < 0 || ny < 0 || nx >= n || ny >= m) continue;
            if (g[nx][ny] == '#' || dist[nx][ny] != -1) continue;
            dist[nx][ny] = dist[x][y] + 1;
            q.push({nx, ny});
        }
    }
    cout << dist[n - 1][m - 1] << "\n";
}
