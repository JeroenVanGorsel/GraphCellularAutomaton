# Graph Visualiser

An HTML page that visualises an (un)oriented graph.

The graph is defined in graph.js as a sparse matrix with zeros and ones

layout.js takes this matrix representation of the graph, and projects each node in 3D (or 2D) spatial coodinates using Fruchterman-Reingold force-directed layout (2D or 3D) 

The HTML page takes the 2D (or 3D) projedcted node coordinates, together with the connectivity matrix from graph.js, and renders the graph either in 2D (or in 3D, allowing the user to rotate it around)


## Node labels vs. node states

Each node carries two independent pieces of data:

- **Label** — the number rendered inside the circle. It is a stable, human-readable identifier stored in the `label` metadata field (e.g. `{ label: '2', state: 1 }`). It never changes.
- **State** — the cellular-automaton value (0 or 1) stored in the `state` metadata field. This is the bit the CA rule reads and writes at each time step, and it is what drives the colour: blue = state 0, red = state 1.

In the built-in example the label strings happen to match the node indices (`"0"`, `"1"`, …), which makes them easy to confuse with the state values.

## Directed vs. undirected graphs

The graph is always directed — the class is `DirectedGraph` and `addEdge(from, to)` creates a one-way edge. Arrowheads are drawn on every edge to reflect this.

To model an undirected graph, add each edge in both directions:

```js
g.addEdge(a, b);
g.addEdge(b, a);
```

This produces a **bidirected** graph, which is semantically equivalent to undirected for CA purposes. There is no dedicated `UndirectedGraph` class and no option to hide arrowheads.

## Live demo

Open `index.html` directly in a browser (no build step or server required).




## Quick start (code)

```js
// 1. Build a graph
const g = new DirectedGraph();
const a = g.addNode({ state: 1 });   // returns index 0
const b = g.addNode({ state: 0 });   // returns index 1
const c = g.addNode({ state: 1 });   // returns index 2
g.addEdge(a, b);
g.addEdge(b, c);
g.addEdge(c, a);   // cycle

// 2. Compute a layout
const layout = new ForceDirectedLayout({ dimensions: 3 });
const positions = layout.compute(g);   // Map<nodeIndex, [x, y, z]>
layout.getPosition(0);                 // → { x, y, z }

// 3. After a topology change, refine incrementally
g.addNode({ state: 0 });
layout.update(g, 50);   // 50 extra iterations at low temperature
```

## API reference

### `DirectedGraph`

| Method | Description |
|---|---|
| `addNode(metadata)` | Add a node; returns its permanent index |
| `removeNode(index)` | Remove a node and all its edges |
| `getNode(index)` | Return the metadata object for a node |
| `getActiveNodes()` | Array of all live node indices |
| `addEdge(from, to)` | Add a directed edge |
| `removeEdge(from, to)` | Remove a directed edge |
| `hasEdge(from, to)` | Return `true` if the edge exists |
| `getEdges()` | All active edges as `[from, to]` pairs |
| `getOutNeighbors(i)` | Nodes reachable in one hop from `i` |
| `getInNeighbors(i)` | Nodes with an edge pointing to `i` |
| `toDenseMatrix()` | Full n×n adjacency matrix (for debugging) |

### `ForceDirectedLayout`

| Method | Description |
|---|---|
| `compute(graph)` | Full layout from scratch; returns `positions` map |
| `update(graph, n?)` | Incremental refinement after topology change (`n` iterations, default 80) |
| `getPosition(index)` | `{ x, y }` or `{ x, y, z }` for one node |
| `getAllPositions()` | Sorted array of `{ index, x, y[, z] }` |

**Options** (pass to constructor):

| Option | Default | Description |
|---|---|---|
| `dimensions` | `3` | `2` or `3` |
| `iterations` | `300` | Steps for `compute()` |
| `width/height/depth` | `200` | Logical bounding box |
| `coolingFactor` | `0.97` | Temperature decay per step |

## Background: Graph Cellular Automata

A standard cellular automaton (e.g. Game of Life) uses a regular lattice as its neighbourhood structure. A GCA replaces that lattice with an arbitrary directed graph:

- **Nodes** are cells; each carries a state.
- **Directed edges** define the neighbourhood: node *j* reads the state of node *i* if the edge *i* → *j* exists.
- **Rules** can not only flip states but also add or remove nodes and edges, so the graph topology itself is part of the automaton's state.

This generalisation allows modelling phenomena that have no natural grid embedding — social networks, neural circuits, reaction graphs, etc.


## Visualisation Features

- **Interactive 2D view** — HTML5 Canvas renderer with pan (drag) and zoom (scroll)
- **Interactive 3D view** — Three.js renderer with orbit controls (drag to rotate, scroll to zoom); loaded lazily
- **Force-directed layout** — Fruchterman-Reingold spring algorithm places nodes automatically in 2D or 3D
- **Incremental re-layout** — after a GCA step changes the topology, `layout.update()` refines positions smoothly instead of restarting from scratch
- **Dynamic graph** — nodes and edges can be added or removed at runtime without invalidating existing indices



## Dependencies

- None for `graph.js` and `layout.js` — plain ES5-compatible JavaScript.
- [Three.js r128](https://threejs.org/) loaded on-demand from jsDelivr CDN when the 3D view is first activated.

