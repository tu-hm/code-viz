# Graph and tree views: one layout per object, elkjs in its own worker

Decided 2026-10-26 (FE-14).

**Decision:**

- A graph or tree is laid out once per object, over the union of every edge that object holds at any step (`graphUnion` in the engine worker), so nodes never move while the program reads its edges or fills `par[]`. The union is undirected when every edge in it has its reverse; the checkbox overrides that. Layers are BFS levels from the lowest node of each component, fed to elkjs as partitions. Above 200 nodes the current step's 2-hop neighbourhood of the current node is laid out instead, cached by its node list.
- elkjs runs in its own worker, spawned from the session on the first layout and terminated with it (`elk.ts`: `elk-api` plus `elk-worker.min.js?url`). Tests swap in the bundled build's in-thread fake worker (`test-setup.ts`).
- "Visited" compares the colour array with its unvisited value: the sparse default, else `-1` when any cell holds it, else an INF-sized value (|v| ≥ 1e9), else `0`/`false`. The legend states the rule (`dist ≠ -1`), because it is a guess (§19.2 #4).
- In a parent array a sparse array's default cells have no parent, and a dense array that holds one value everywhere has no edges.
- The first-visit (DFS) tree, computed in the worker over the whole trace (`firstVisits`): a node is visited at a step where its colour cell goes from the unvisited value to another, and that unvisited value is what every cell last held at once (`fill(dist, ..., -1)` gives `-1`, a zeroed `vis[]` `false`). Its parent is the first index variable of the adjacency list (`u` in `adj[u]` or `for (v : adj[u])`), looked up from the innermost frame outward, that holds another node with an edge to it. An edge holds from that step until the node turns unvisited again.

**Why:** a per-step layout jumps every time an edge arrives, which §19.10 rules out. The bundled elkjs, loaded in a Web Worker, finds no fake worker to export and sets `self.onmessage`, which would take the Comlink messages meant for the engine; it failed with "_Worker is not a constructor". A zeroed `dist[]` before `fill(-1)` would otherwise make every node visited at the first step. Looking outward through the frames gives one rule for BFS (`dist[v] = dist[u] + 1`, `u` in the same frame) and recursive DFS (`vis[u] = true`, the parent's `u` in the caller's frame). A zeroed global `int par[N]` otherwise reads as every node under node 0 at the first step, and the union then keeps that phantom tree in the layout.

**How to apply:** keep layouts keyed by object, kind and the undirected choice; don't lay out per step. Don't import `elkjs/lib/elk.bundled.js` outside tests. A new graph source adds its shape to `graphShape` so the union and the view read it the same way.
