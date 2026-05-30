# graphs/

This folder contains the graph data structure and the library of preset graphs used by the viewer.

## Files

| File | Contents |
|---|---|
| `graph.js` | `SparseAdjacencyMatrix`, `Graph`, `DirectedGraph` — core data structures |
| `presets.js` | Factory functions for preset graphs; depends on `graph.js` |
| `graphs.md` | This file |

---

## graph.js — Core classes

### `Graph`

```js
new Graph({ type?, valueType? })
```

| Option | Values | Default |
|---|---|---|
| `type` | `'directed'` · `'undirected'` · `'bidirectional'` | `'directed'` |
| `valueType` | `'binary'` · `'integer'` · `'float'` | `'binary'` |

| Method | Description |
|---|---|
| `addNode(metadata)` | Add a node; returns its permanent index |
| `removeNode(index)` | Tombstone a node and remove all its edges |
| `getNode(index)` | Return the metadata object for a node |
| `getActiveNodes()` | Array of all live node indices |
| `nodeCount` | Number of active nodes |
| `addEdge(from, to)` | Add an edge (symmetric for undirected/bidirectional) |
| `removeEdge(from, to)` | Remove an edge (symmetric for undirected/bidirectional) |
| `hasEdge(from, to)` | Return `true` if the edge exists |
| `getEdges()` | Active edges as `[from, to]` pairs (deduplicated for undirected/bidirectional) |
| `getOutNeighbors(i)` | Nodes reachable in one hop from `i` |
| `getInNeighbors(i)` | Nodes with an edge pointing to `i` |
| `getNeighbors(i)` | Union of in- and out-neighbours (deduped) |
| `toDenseMatrix()` | Full n×n adjacency matrix (for debugging) |

`DirectedGraph` is a backward-compatible alias for `new Graph({ type: 'directed', valueType: 'binary' })`.

---

## presets.js — Preset graph library

Each factory function returns a `Graph`.  If it also attaches a `graph.positions` property (`Map<nodeIndex, [x, y, z]>`), the viewer uses those coordinates directly instead of running the force-directed layout, so the initial arrangement is deterministic.

### `buildExampleGraph()`

The default startup graph.

- **Type**: directed
- **Value type**: integer (states 1–9, gradient coloured)
- **Nodes**: 7
- **Topology**: tree-like fan-out from node 0, converging at node 6, with a back-edge 6→0 forming a cycle
- **Layout**: force-directed (random initial positions, 400 iterations)

```
0 → 1 → 3
↓   ↓     ↘
2 → 4 ──→ 6 → 0
 ↘         ↑
  5 ────────┘
```

### `buildDirectedBinaryGraph()`

The original 5-node directed binary example.

- **Type**: directed
- **Value type**: binary (states 0/1)
- **Nodes**: 5
- **Topology**: directed cycle with a shortcut back-edge
- **Layout**: force-directed

```
0 → 1 → 2 → 3
    ↑       ↓
    └── 4 ←─┘
```

### `buildBinaryLattice2D(rows?, cols?)`

A rectangular grid of nodes connected to their nearest neighbours (right and down).

- **Type**: undirected
- **Value type**: binary (all states start at 0)
- **Nodes**: `rows × cols` (default 5×5 = 25)
- **Edges**: `(rows−1)×cols + rows×(cols−1)` (default 40)
- **Layout**: pre-computed grid — nodes are placed on an evenly-spaced rectangular grid, bypassing force-directed layout for a clean initial display

```
0,0 — 0,1 — 0,2 — …
 |     |     |
1,0 — 1,1 — 1,2 — …
 |     |     |
…
```

Node labels are `"row,col"` strings.

---

## Adding a new preset

1. Write a factory function in `presets.js`:

   ```js
   function buildMyGraph() {
     const g = new Graph({ type: 'undirected', valueType: 'binary' });
     // ... add nodes and edges ...

     // Optional: attach fixed positions so the viewer skips force layout.
     // Keys are node indices; values are [x, y, z] in the [-100, 100] logical box.
     g.positions = new Map([
       [0, [-50, 0, 0]],
       [1, [ 50, 0, 0]],
     ]);

     return g;
   }
   ```

2. Export it at the bottom of `presets.js` (both the `module.exports` and `window.GraphCA` blocks).

3. Add an entry to the **Reset graph** dropdown in `index.html` (inside `<div class="dropdown-menu">`):

   ```html
   <button onclick="resetGraph('mygraph')">My graph</button>
   ```

4. Handle the new key in the `resetGraph()` function in `index.html`:

   ```js
   } else if (preset === 'mygraph') {
     graph = buildMyGraph();
     // If graph.positions is set, the viewer will use it automatically.
     recomputeLayout();   // or use graph.positions like the lattice2d branch does
   }
   ```

5. Document it in this file.
