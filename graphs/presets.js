/**
 * graphs/presets.js — Preset graph factory functions.
 *
 * Each function returns a fully constructed Graph with nodes, edges, and initial
 * node states. Preset graphs also carry pre-calculated layout positions (stored
 * as a `positions` property — a Map<nodeIndex, [x, y, z]>) so the viewer can
 * bypass the force-directed layout and display a clean initial arrangement.
 *
 * HOW TO ADD A NEW PRESET
 * -----------------------
 * 1. Write a function `buildMyGraph()` that constructs and returns a Graph.
 *    Optionally attach `graph.positions` (Map<index, [x, y, z]>) for a fixed
 *    starting layout; omit it to let the viewer run the force-directed layout.
 * 2. Export the function at the bottom of this file.
 * 3. Register it in the Reset-graph dropdown in index.html (see `resetGraph()`).
 * 4. Document it in graphs/graphs.md.
 *
 * Dependencies: graphs/graph.js must be loaded before this file.
 */

// ---------------------------------------------------------------------------
// buildExampleGraph
// ---------------------------------------------------------------------------

/**
 * Build the default example graph (directed, integer-valued nodes, 7 nodes).
 *
 * Topology (a connected tree-like structure with a back-edge forming a cycle):
 *
 *   0 → 1 → 3
 *   ↓   ↓     ↘
 *   2 → 4 ──→ 6 → 0
 *    ↘         ↑
 *     5 ────────┘
 *
 * Node states are integers in [1, 9] to exercise gradient coloring.
 *
 * @returns {Graph}
 */
function buildExampleGraph() {
  const g = new Graph({ type: 'directed', valueType: 'integer' });

  const n0 = g.addNode({ label: '0', state: 5 });
  const n1 = g.addNode({ label: '1', state: 3 });
  const n2 = g.addNode({ label: '2', state: 7 });
  const n3 = g.addNode({ label: '3', state: 1 });
  const n4 = g.addNode({ label: '4', state: 9 });
  const n5 = g.addNode({ label: '5', state: 2 });
  const n6 = g.addNode({ label: '6', state: 6 });

  // Fan-out from 0, converge at 6, with a back-edge to form a cycle
  g.addEdge(n0, n1);
  g.addEdge(n0, n2);
  g.addEdge(n1, n3);
  g.addEdge(n1, n4);
  g.addEdge(n2, n4);
  g.addEdge(n2, n5);
  g.addEdge(n3, n6);
  g.addEdge(n4, n6);
  g.addEdge(n5, n6);
  g.addEdge(n6, n0); // back-edge: creates a cycle

  return g;
}

// ---------------------------------------------------------------------------
// buildDirectedBinaryGraph
// ---------------------------------------------------------------------------

/**
 * Build the original directed binary-state example graph (5-node cycle).
 *
 * Topology:
 *   0 → 1 → 2 → 3
 *       ↑       ↓
 *       └── 4 ←─┘
 *
 * @returns {Graph}
 */
function buildDirectedBinaryGraph() {
  const g = new Graph({ type: 'directed', valueType: 'binary' });

  const n0 = g.addNode({ label: '0', state: 1 });
  const n1 = g.addNode({ label: '1', state: 0 });
  const n2 = g.addNode({ label: '2', state: 1 });
  const n3 = g.addNode({ label: '3', state: 0 });
  const n4 = g.addNode({ label: '4', state: 1 });

  g.addEdge(n0, n1);
  g.addEdge(n1, n2);
  g.addEdge(n2, n3);
  g.addEdge(n3, n4);
  g.addEdge(n4, n1);

  return g;
}

// ---------------------------------------------------------------------------
// buildBinaryLattice2D
// ---------------------------------------------------------------------------

/**
 * Build an undirected binary 2D lattice graph with nearest-neighbour edges.
 *
 * All node states start at 0.  Edges connect each node to its right and bottom
 * neighbour so that exactly (rows-1)*cols + rows*(cols-1) edges are created.
 * A pre-computed grid layout is attached as `graph.positions` so the viewer
 * skips force-directed layout and shows a clean rectangular grid immediately.
 *
 * Topology example (3×3):
 *
 *   0,0 — 0,1 — 0,2
 *    |     |     |
 *   1,0 — 1,1 — 1,2
 *    |     |     |
 *   2,0 — 2,1 — 2,2
 *
 * @param {number} [rows=5]
 * @param {number} [cols=5]
 * @returns {Graph}
 */
function buildBinaryLattice2D(rows = 5, cols = 5) {
  const g = new Graph({ type: 'undirected', valueType: 'binary' });
  const ids = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ids.push(g.addNode({ label: `${r},${c}`, state: 0 }));
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = ids[r * cols + c];
      if (c + 1 < cols) g.addEdge(id, ids[r * cols + c + 1]);
      if (r + 1 < rows) g.addEdge(id, ids[(r + 1) * cols + c]);
    }
  }

  // Pre-compute evenly-spaced grid positions so the viewer can use them directly.
  // Spacing is chosen so the grid fits within the layout's [-100, 100] logical box.
  const spacing = Math.min(150 / Math.max(rows - 1, 1), 150 / Math.max(cols - 1, 1));
  const halfR = (rows - 1) / 2;
  const halfC = (cols - 1) / 2;
  const positions = new Map();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      positions.set(r * cols + c, [(c - halfC) * spacing, (r - halfR) * spacing, 0]);
    }
  }
  g.positions = positions;

  return g;
}

// ---------------------------------------------------------------------------
// buildSphereLattice2D
// ---------------------------------------------------------------------------

/**
 * Build an undirected binary 2D lattice graph whose nodes lie on the surface
 * of a sphere (latitude-longitude grid).
 *
 * All node states start at 0.  Longitude edges wrap around (last column
 * connects back to the first), while latitude edges do not (the top and
 * bottom rows are open borders — no degenerate pole nodes).
 *
 * θ is kept strictly inside (0, π) so no two nodes collapse to the same
 * pole point; φ covers the full [0, 2π) circle with wrap-around connectivity.
 *
 * Topology example (2 rows × 4 cols):
 *
 *   0,0 — 0,1 — 0,2 — 0,3 —(wraps)— 0,0
 *    |     |     |     |
 *   1,0 — 1,1 — 1,2 — 1,3 —(wraps)— 1,0
 *
 * @param {number}  [rows=6]
 * @param {number}  [cols=8]
 * @param {number}  [radius=80]        - Sphere radius in layout units.
 * @param {boolean} [randomStates=false] - If true, each node starts with a random binary state.
 * @returns {Graph}
 */
function buildSphereLattice2D(rows = 6, cols = 8, radius = 80, randomStates = false) {
  const g = new Graph({ type: 'undirected', valueType: 'binary' });
  const ids = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ids.push(g.addNode({ label: `${r},${c}`, state: randomStates ? Math.round(Math.random()) : 0 }));
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = ids[r * cols + c];
      // Longitude: wrap around (last column → first column)
      g.addEdge(id, ids[r * cols + ((c + 1) % cols)]);
      // Latitude: no wrap (top and bottom rows are open borders)
      if (r + 1 < rows) g.addEdge(id, ids[(r + 1) * cols + c]);
    }
  }

  // Pre-compute positions on the sphere surface.
  // θ ∈ (0, π) avoids degenerate poles; φ ∈ [0, 2π) wraps the longitude.
  const positions = new Map();
  for (let r = 0; r < rows; r++) {
    const theta = ((r + 1) / (rows + 1)) * Math.PI;
    for (let c = 0; c < cols; c++) {
      const phi = (c / cols) * 2 * Math.PI;
      positions.set(r * cols + c, [
        radius * Math.sin(theta) * Math.cos(phi),
        radius * Math.sin(theta) * Math.sin(phi),
        radius * Math.cos(theta),
      ]);
    }
  }
  g.positions = positions;

  return g;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildExampleGraph, buildDirectedBinaryGraph, buildBinaryLattice2D, buildSphereLattice2D };
} else {
  window.GraphCA = window.GraphCA || {};
  Object.assign(window.GraphCA, { buildExampleGraph, buildDirectedBinaryGraph, buildBinaryLattice2D, buildSphereLattice2D });
}
