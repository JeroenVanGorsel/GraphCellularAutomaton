# Graph Cellular Automaton

An interactive browser-based visualiser for Graph Cellular Automata (GCA). Define a graph in `graph.js`, and the viewer renders it in 2D or 3D with a force-directed layout — no build step or server required.

## File structure

```
index.html                  — viewer (2D + 3D renderer, toolbar, legend)
graph.js                    — Graph class, SparseAdjacencyMatrix, factory functions
visualisation/layout.js     — ForceDirectedLayout (Fruchterman-Reingold)
```

## Live demo

Open `index.html` directly in a browser.

---

## Graph types

The `Graph` class supports three edge modes, set via the `type` constructor option:

| `type` | Behaviour | Visual |
|---|---|---|
| `'directed'` | `addEdge(A, B)` stores only A→B | Arrowhead at target |
| `'undirected'` | `addEdge(A, B)` stores A→B and B→A | Plain line, no arrowhead |
| `'bidirectional'` | `addEdge(A, B)` stores A→B and B→A | Arrowheads at both ends |

For `undirected` and `bidirectional`, `getEdges()` returns only canonical pairs (`from ≤ to`) so each edge is drawn once.

## Node value types

Each node carries a `state` field whose meaning is set via the `valueType` constructor option:

| `valueType` | `state` values | Colour mapping |
|---|---|---|
| `'binary'` | `0` or `1` | Blue (0) / Orange-red (1) |
| `'integer'` | Any whole number | Gradient: blue (min) → orange-red (max) |
| `'float'` | Any real number | Gradient: blue (min) → orange-red (max) |

The colour range for `integer` and `float` is computed dynamically from the min/max state across all active nodes. The legend in the viewer updates automatically to reflect the current graph's type and value type.

## Node labels vs. node states

Each node carries two independent pieces of data:

- **Label** — the text rendered inside the circle. A stable human-readable identifier stored in the `label` metadata field. Never changes during a CA run.
- **State** — the cellular-automaton value stored in the `state` metadata field. Read and written by CA rules; drives the node colour.

In the built-in example the label strings happen to match the node indices (`"0"`, `"1"`, …), which makes them easy to confuse with the state values.

---

## Quick start (code)

```js
// 1. Build a graph
const g = new Graph({ type: 'directed', valueType: 'integer' });

const a = g.addNode({ label: 'A', state: 3 });
const b = g.addNode({ label: 'B', state: 7 });
const c = g.addNode({ label: 'C', state: 1 });

g.addEdge(a, b);   // A → B
g.addEdge(b, c);   // B → C
g.addEdge(c, a);   // C → A  (cycle)

// 2. Compute a layout
const layout = new ForceDirectedLayout({ dimensions: 3 });
const positions = layout.compute(g);   // Map<nodeIndex, [x, y, z]>
layout.getPosition(0);                 // → { x, y, z }

// 3. After a topology change, refine incrementally
g.addNode({ label: 'D', state: 5 });
layout.update(g, 50);   // 50 extra iterations at low temperature
```

---

## API reference

### `Graph`

```js
new Graph({ type?: 'directed'|'undirected'|'bidirectional',
            valueType?: 'binary'|'integer'|'float' })
```

| Method | Description |
|---|---|
| `addNode(metadata)` | Add a node; returns its permanent index |
| `removeNode(index)` | Remove a node and all its edges |
| `getNode(index)` | Return the metadata object for a node |
| `getActiveNodes()` | Array of all live node indices |
| `nodeCount` | Number of active nodes |
| `addEdge(from, to)` | Add an edge (symmetric for undirected/bidirectional) |
| `removeEdge(from, to)` | Remove an edge (symmetric for undirected/bidirectional) |
| `hasEdge(from, to)` | Return `true` if the edge exists |
| `getEdges()` | Active edges as `[from, to]` pairs (deduplicated for undirected/bidirectional) |
| `getOutNeighbors(i)` | Nodes reachable in one hop from `i` |
| `getInNeighbors(i)` | Nodes with an edge pointing to `i` (same as out-neighbours for undirected) |
| `getNeighbors(i)` | Union of in- and out-neighbours (deduped) |
| `toDenseMatrix()` | Full n×n adjacency matrix (for debugging) |

`DirectedGraph` is kept as a backward-compatible alias for `new Graph({ type: 'directed', valueType: 'binary' })`.

### Factory functions

| Function | Returns |
|---|---|
| `buildExampleGraph()` | Default example (directed, integer values, 7 nodes with a cycle) |
| `buildDirectedBinaryGraph()` | The original 5-node directed binary example |

### `ForceDirectedLayout`  *(in `visualisation/layout.js`)*

```js
new ForceDirectedLayout({ dimensions?: 2|3, iterations?: number,
                          width?: number, height?: number, depth?: number,
                          coolingFactor?: number })
```

| Method | Description |
|---|---|
| `compute(graph)` | Full layout from scratch; returns position map |
| `update(graph, n?)` | Incremental refinement after topology change (`n` iterations, default 80) |
| `getPosition(index)` | `{ x, y }` or `{ x, y, z }` for one node |
| `getAllPositions()` | Sorted array of `{ index, x, y[, z] }` |

**Constructor options:**

| Option | Default | Description |
|---|---|---|
| `dimensions` | `3` | `2` or `3` |
| `iterations` | `300` | Steps for `compute()` |
| `width` / `height` / `depth` | `200` | Logical bounding box |
| `coolingFactor` | `0.97` | Temperature decay per step |

---

## Visualisation features

- **2D view** — HTML5 Canvas with pan (drag) and zoom (scroll wheel)
- **3D view** — Three.js with orbit controls (drag to rotate, scroll to zoom); loaded lazily from CDN on first use
- **Aligned transition** — the 3D camera starts directly above the 2D plane, so switching modes shows the same layout from the same angle
- **Force-directed layout** — Fruchterman-Reingold places nodes automatically; works in 2D and 3D
- **Incremental re-layout** — `layout.update()` refines positions smoothly after topology changes instead of restarting
- **Adaptive colouring** — binary: two fixed colours; integer/float: gradient scaled to the current min/max state
- **Dynamic legend** — updates automatically to reflect the active graph's edge type and value type
- **Label toggle** — the **Labels** button in the toolbar shows or hides node label text in both 2D and 3D
- **Value toggle** — the **Values** button shows or hides each node's state value below the node; formats automatically as `0`/`1` (binary), an integer, or a 2-decimal float

---

## Background: Graph Cellular Automata

A standard cellular automaton (e.g. Game of Life) uses a regular lattice as its neighbourhood structure. A GCA replaces that lattice with an arbitrary graph:

- **Nodes** are cells; each carries a state value.
- **Edges** define the neighbourhood: which nodes influence which.
- **Rules** can not only update states but also add or remove nodes and edges — the graph topology itself is part of the automaton's state.

This generalisation allows modelling phenomena that have no natural grid embedding: social networks, neural circuits, reaction graphs, and more.

---

## Dependencies

- `graph.js` and `visualisation/layout.js` — plain JavaScript, no dependencies.
- [Three.js r128](https://threejs.org/) — loaded on demand from jsDelivr CDN when the 3D view is first activated.
