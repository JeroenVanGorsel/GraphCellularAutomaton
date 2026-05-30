/**
 * graph.js — Graph (directed, undirected, or bidirectional) as a sparse adjacency matrix.
 *
 * EDGE TYPES
 * ----------
 * 'directed'      — Edges have a single direction (A→B does not imply B→A).
 *                   addEdge(A, B) stores only A→B. Rendered with one arrowhead.
 * 'undirected'    — Edges have no direction (A-B equals B-A).
 *                   addEdge(A, B) stores both directions internally.
 *                   getEdges() returns canonical pairs (from < to) to avoid duplicates.
 *                   Rendered as plain lines without arrowheads.
 * 'bidirectional' — All connections are two-way; same internal storage as undirected.
 *                   Rendered with arrowheads at both ends.
 *
 * NODE VALUE TYPES
 * ----------------
 * 'binary'  — node.state ∈ {0, 1}
 * 'integer' — node.state ∈ ℤ  (any whole number)
 * 'float'   — node.state ∈ ℝ  (any real number)
 *
 * CELLULAR AUTOMATA RELEVANCE
 * ---------------------------
 * In a Graph Cellular Automaton (GCA) each node has a state, and at each time step
 * every node updates its state based on the states of its neighbours. The adjacency
 * matrix defines the neighbourhood structure. GCA rules can also add or remove nodes
 * and edges, so the graph topology itself evolves over time.
 *
 * USAGE EXAMPLE
 * -------------
 *   const g = new Graph({ type: 'undirected', valueType: 'integer' });
 *   const a = g.addNode({ state: 3 });
 *   const b = g.addNode({ state: 7 });
 *   g.addEdge(a, b);  // automatically adds b→a as well
 *   console.log(g.getNeighbors(a));   // [1]
 *   console.log(g.toDenseMatrix());   // full n×n array for inspection
 */

// ---------------------------------------------------------------------------
// SparseAdjacencyMatrix
// ---------------------------------------------------------------------------

/**
 * A sparse representation of a binary (0/1) adjacency matrix.
 *
 * Internally stores only the 1-entries as string keys "row,col" in a Map, so
 * memory usage scales with the number of edges rather than with n².
 *
 * @class
 */
class SparseAdjacencyMatrix {
  /**
   * @param {number} [initialSize=0] - Initial number of nodes (rows/columns).
   */
  constructor(initialSize = 0) {
    /** @type {number} */
    this.size = initialSize;

    /** @type {Map<string, 1>} */
    this._edges = new Map();
  }

  /** @private */
  _key(row, col) {
    return `${row},${col}`;
  }

  /**
   * Return 1 if the directed edge (row→col) exists, else 0.
   * @param {number} row
   * @param {number} col
   * @returns {0|1}
   */
  get(row, col) {
    return this._edges.has(this._key(row, col)) ? 1 : 0;
  }

  /**
   * Set the matrix entry at (row, col). 1 adds the edge; 0 removes it.
   * @param {number} row
   * @param {number} col
   * @param {0|1} value
   */
  set(row, col, value) {
    if (value) {
      this._edges.set(this._key(row, col), 1);
    } else {
      this._edges.delete(this._key(row, col));
    }
  }

  /**
   * Return all edges as an array of [from, to] index pairs.
   * @returns {[number, number][]}
   */
  getAllEdges() {
    return [...this._edges.keys()].map(k => {
      const [r, c] = k.split(',');
      return [parseInt(r, 10), parseInt(c, 10)];
    });
  }

  /**
   * Return all out-neighbours of source (nodes j where A[source][j] = 1).
   * @param {number} source
   * @returns {number[]}
   */
  getOutNeighbors(source) {
    const result = [];
    for (let j = 0; j < this.size; j++) {
      if (this._edges.has(this._key(source, j))) result.push(j);
    }
    return result;
  }

  /**
   * Return all in-neighbours of target (nodes i where A[i][target] = 1).
   * @param {number} target
   * @returns {number[]}
   */
  getInNeighbors(target) {
    const result = [];
    for (let i = 0; i < this.size; i++) {
      if (this._edges.has(this._key(i, target))) result.push(i);
    }
    return result;
  }

  /**
   * Remove all edges involving the given node index (as source or target).
   * @param {number} nodeIndex
   */
  removeAllEdgesForNode(nodeIndex) {
    for (const key of [...this._edges.keys()]) {
      const [r, c] = key.split(',');
      if (parseInt(r, 10) === nodeIndex || parseInt(c, 10) === nodeIndex) {
        this._edges.delete(key);
      }
    }
  }

  /** Expand the matrix to accommodate one new node. */
  grow() {
    this.size++;
  }

  /**
   * Produce a full (dense) n×n 2D array. Avoid on large graphs.
   * @returns {number[][]}
   */
  toDenseMatrix() {
    const m = Array.from({ length: this.size }, () => new Array(this.size).fill(0));
    for (const [key] of this._edges) {
      const [r, c] = key.split(',');
      m[parseInt(r, 10)][parseInt(c, 10)] = 1;
    }
    return m;
  }

  /** @returns {number} */
  get edgeCount() {
    return this._edges.size;
  }
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

/**
 * A graph supporting directed, undirected, and bidirectional edges, with
 * binary, integer, or floating-point node state values.
 *
 * @class
 */
class Graph {
  /**
   * @param {Object} [options]
   * @param {'directed'|'undirected'|'bidirectional'} [options.type='directed']
   * @param {'binary'|'integer'|'float'} [options.valueType='binary']
   */
  constructor(options = {}) {
    /**
     * How edges are stored and rendered.
     * @type {'directed'|'undirected'|'bidirectional'}
     */
    this.type = options.type ?? 'directed';

    /**
     * What kind of values node states hold.
     * @type {'binary'|'integer'|'float'}
     */
    this.valueType = options.valueType ?? 'binary';

    /** @type {SparseAdjacencyMatrix} */
    this._matrix = new SparseAdjacencyMatrix(0);

    /**
     * Per-node metadata. Index i holds the node object, or null if deleted.
     * @type {(Object|null)[]}
     */
    this._nodes = [];
  }

  // ── Node management ──────────────────────────────────────────────────────

  /**
   * Add a new node and return its permanent index.
   *
   * @param {Object} [metadata={}] - Arbitrary data; typically includes `state`.
   * @returns {number} The index of the newly created node.
   */
  addNode(metadata = {}) {
    const index = this._nodes.length;
    this._nodes.push({ ...metadata });
    this._matrix.grow();
    return index;
  }

  /**
   * Remove node at the given index along with all its edges.
   * The slot is tombstoned (null) so other indices remain stable.
   *
   * @param {number} index
   * @throws {Error} If the index is out of range or already deleted.
   */
  removeNode(index) {
    if (index < 0 || index >= this._nodes.length || this._nodes[index] === null) {
      throw new Error(`removeNode: node ${index} does not exist.`);
    }
    this._matrix.removeAllEdgesForNode(index);
    this._nodes[index] = null;
  }

  /**
   * Return the metadata object for the given node index.
   * @param {number} index
   * @returns {Object}
   * @throws {Error} If the node does not exist.
   */
  getNode(index) {
    if (index < 0 || index >= this._nodes.length || this._nodes[index] === null) {
      throw new Error(`getNode: node ${index} does not exist.`);
    }
    return this._nodes[index];
  }

  /**
   * Return an array of all currently active (non-deleted) node indices.
   * @returns {number[]}
   */
  getActiveNodes() {
    const result = [];
    for (let i = 0; i < this._nodes.length; i++) {
      if (this._nodes[i] !== null) result.push(i);
    }
    return result;
  }

  /** @returns {number} */
  get nodeCount() {
    return this._nodes.filter(n => n !== null).length;
  }

  // ── Edge management ──────────────────────────────────────────────────────

  /**
   * Add an edge between `from` and `to`.
   *
   * For 'undirected' and 'bidirectional' graphs the reverse edge (to→from) is
   * also stored automatically so neighbourhood queries are always symmetric.
   *
   * @param {number} from
   * @param {number} to
   * @throws {Error} If either node does not exist.
   */
  addEdge(from, to) {
    this._assertNodeExists(from);
    this._assertNodeExists(to);
    this._matrix.set(from, to, 1);
    if (this.type === 'undirected' || this.type === 'bidirectional') {
      this._matrix.set(to, from, 1);
    }
  }

  /**
   * Remove the edge from `from` to `to`.
   * For undirected/bidirectional graphs the reverse edge is also removed.
   *
   * @param {number} from
   * @param {number} to
   */
  removeEdge(from, to) {
    this._matrix.set(from, to, 0);
    if (this.type === 'undirected' || this.type === 'bidirectional') {
      this._matrix.set(to, from, 0);
    }
  }

  /**
   * Return true if an edge from→to exists.
   * @param {number} from
   * @param {number} to
   * @returns {boolean}
   */
  hasEdge(from, to) {
    return this._matrix.get(from, to) === 1;
  }

  /**
   * Return all edges as [from, to] index pairs.
   *
   * For 'undirected' and 'bidirectional' graphs, only the canonical form
   * (from ≤ to) is returned to avoid duplicate entries per edge.
   *
   * @returns {[number, number][]}
   */
  getEdges() {
    const allEdges = this._matrix.getAllEdges().filter(
      ([f, t]) => this._nodes[f] !== null && this._nodes[t] !== null
    );
    if (this.type === 'undirected' || this.type === 'bidirectional') {
      return allEdges.filter(([f, t]) => f <= t);
    }
    return allEdges;
  }

  /**
   * Return the out-neighbours of node `index` (nodes j where edge index→j exists).
   * @param {number} index
   * @returns {number[]}
   */
  getOutNeighbors(index) {
    return this._matrix.getOutNeighbors(index).filter(j => this._nodes[j] !== null);
  }

  /**
   * Return the in-neighbours of node `index` (nodes i where edge i→index exists).
   * For undirected graphs this is identical to getOutNeighbors.
   * @param {number} index
   * @returns {number[]}
   */
  getInNeighbors(index) {
    if (this.type === 'undirected') {
      return this.getOutNeighbors(index);
    }
    return this._matrix.getInNeighbors(index).filter(i => this._nodes[i] !== null);
  }

  /**
   * Return all neighbours of node `index` (union of in- and out-neighbours, deduplicated).
   * Useful for undirected graphs where in and out are the same, and for directed graphs
   * where you want all adjacent nodes regardless of direction.
   * @param {number} index
   * @returns {number[]}
   */
  getNeighbors(index) {
    const set = new Set([...this.getOutNeighbors(index), ...this.getInNeighbors(index)]);
    return [...set];
  }

  // ── Matrix export ─────────────────────────────────────────────────────────

  /**
   * Export the adjacency matrix in dense form (for debugging / external tools).
   * @returns {number[][]}
   */
  toDenseMatrix() {
    return this._matrix.toDenseMatrix();
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /** @private */
  _assertNodeExists(index) {
    if (index < 0 || index >= this._nodes.length || this._nodes[index] === null) {
      throw new Error(`Node ${index} does not exist or has been removed.`);
    }
  }
}

// ---------------------------------------------------------------------------
// DirectedGraph — backward-compatible alias
// ---------------------------------------------------------------------------

/**
 * A directed binary-state graph. Kept for backward compatibility.
 * Equivalent to `new Graph({ type: 'directed', valueType: 'binary' })`.
 *
 * @class
 * @extends Graph
 */
class DirectedGraph extends Graph {
  constructor() {
    super({ type: 'directed', valueType: 'binary' });
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Build the default example graph: undirected with integer-valued nodes.
 *
 * Topology (a connected tree-like structure with a shared hub):
 *
 *   0 ─ 1 ─ 3
 *   |   |     \
 *   2 ─ 4 ─── 6
 *    \         |
 *     5 ───────┘
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

/**
 * Build an undirected binary 2D lattice graph with nearest-neighbour edges.
 *
 * All node states start at 0.  Edges connect each node to its right and bottom
 * neighbour so that exactly (rows-1)*cols + rows*(cols-1) edges are created.
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
  return g;
}

// Export for use in other modules (browser globals or ES module environments)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SparseAdjacencyMatrix,
    Graph,
    DirectedGraph,
    buildExampleGraph,
    buildDirectedBinaryGraph,
    buildBinaryLattice2D,
  };
} else {
  window.GraphCA = window.GraphCA || {};
  Object.assign(window.GraphCA, {
    SparseAdjacencyMatrix,
    Graph,
    DirectedGraph,
    buildExampleGraph,
    buildDirectedBinaryGraph,
    buildBinaryLattice2D,
  });
}
