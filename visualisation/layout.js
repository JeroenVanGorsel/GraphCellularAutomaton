/**
 * layout.js — Force-directed graph layout producing 2D or 3D node coordinates.
 *
 * OVERVIEW
 * --------
 * Given a DirectedGraph (defined in graph.js), this module computes a spatial
 * position for every active node so that the graph can be drawn legibly.
 *
 * ALGORITHM: FRUCHTERMAN-REINGOLD FORCE-DIRECTED LAYOUT
 * -------------------------------------------------------
 * Every pair of nodes exerts a repulsive force (they push each other apart,
 * like charges of the same sign). Every edge additionally exerts an attractive
 * force that pulls the two endpoints together (like a spring).
 *
 * At each iteration the net force on each node is computed and the node is
 * displaced by a fraction of that force (the "temperature" t). The temperature
 * is reduced each iteration (simulated annealing), so the system gradually
 * settles into a stable equilibrium.
 *
 * The same algorithm runs identically in 2D and 3D—just add a z component.
 *
 * REFERENCE
 * ---------
 * Fruchterman, T. M. J., & Reingold, E. M. (1991).
 * "Graph Drawing by Force-directed Placement."
 * Software: Practice and Experience, 21(11), 1129–1164.
 *
 * CELLULAR AUTOMATA RELEVANCE
 * ---------------------------
 * After each GCA step the graph topology may change (nodes added/removed,
 * edges rewired). Call `layout.update(graph)` to incrementally re-run a few
 * layout iterations starting from the current positions, giving a smooth
 * visual transition rather than a complete restart.
 *
 * USAGE EXAMPLE (browser, after loading graph.js)
 * ------------------------------------------------
 *   const g = GraphCA.buildExampleGraph();
 *
 *   const layout = new ForceDirectedLayout({ dimensions: 3 });
 *   const positions = layout.compute(g);
 *   // positions[0] → { x, y, z }
 *   // positions[1] → { x, y, z }
 *   // ...
 *
 *   // After a GCA step that modified g:
 *   layout.update(g, 50);  // refine with 50 more iterations
 */

// ---------------------------------------------------------------------------
// Vector helpers (works for both 2D and 3D)
// ---------------------------------------------------------------------------

/**
 * Create a zero vector for the given number of dimensions.
 * @param {2|3} dims
 * @returns {number[]}
 */
function zeroVec(dims) {
  return new Array(dims).fill(0);
}

/**
 * Add vector `b` into vector `a` in-place and return `a`.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number[]}
 */
function vecAddInPlace(a, b) {
  for (let i = 0; i < a.length; i++) a[i] += b[i];
  return a;
}

/**
 * Compute the Euclidean distance between two vectors.
 * Returns a small epsilon instead of 0 to avoid division-by-zero.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function vecDist(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum) || 1e-6;
}

/**
 * Return a new vector that is `a - b` scaled by `scale`.
 * @param {number[]} a
 * @param {number[]} b
 * @param {number} scale
 * @returns {number[]}
 */
function scaledDiff(a, b, scale) {
  return a.map((ai, i) => (ai - b[i]) * scale);
}

/**
 * Clamp the magnitude of vector `v` to at most `limit`, in-place.
 * @param {number[]} v
 * @param {number} limit
 * @returns {number[]}
 */
function clampMagnitude(v, limit) {
  let mag = 0;
  for (const c of v) mag += c * c;
  mag = Math.sqrt(mag);
  if (mag > limit) {
    const s = limit / mag;
    for (let i = 0; i < v.length; i++) v[i] *= s;
  }
  return v;
}

// ---------------------------------------------------------------------------
// ForceDirectedLayout
// ---------------------------------------------------------------------------

/**
 * Computes and stores 2D or 3D positions for graph nodes using
 * the Fruchterman-Reingold spring-and-repulsion algorithm.
 *
 * @class
 */
class ForceDirectedLayout {
  /**
   * @param {Object} [options]
   * @param {2|3}    [options.dimensions=3]    - Dimensionality of the output.
   * @param {number} [options.iterations=300]  - Iterations for a full `compute()` call.
   * @param {number} [options.width=200]       - Logical canvas width (sets the optimal edge length k).
   * @param {number} [options.height=200]      - Logical canvas height.
   * @param {number} [options.depth=200]       - Logical canvas depth (only used in 3D).
   * @param {number} [options.coolingFactor=0.97] - Multiplicative temperature decay per iteration.
   *   Values close to 1 cool slowly (smoother but slower); closer to 0.9 cools fast.
   */
  constructor(options = {}) {
    this.dimensions    = options.dimensions    ?? 3;
    this.iterations    = options.iterations    ?? 300;
    this.width         = options.width         ?? 200;
    this.height        = options.height        ?? 200;
    this.depth         = options.depth         ?? 200;
    this.coolingFactor = options.coolingFactor ?? 0.97;

    // Live-simulation state for dynamic spatial adjustment (toggled by the viewer).
    // liveTemperature decays toward liveFloor each tick(); boostTemperature() injects
    // energy after topology changes so the layout can re-optimise without big jumps.
    this.liveTemperature    = 0;
    this.liveFloor          = 0.3;
    this.liveSpeedMultiplier = 1.0; // scaled by the UI speed slider (0.1 = slow, 1.0 = default, 2.0 = fast)

    /**
     * Current positions: map from node index to coordinate array [x, y] or [x, y, z].
     * Persists between `update()` calls so the layout can be refined incrementally.
     * @type {Map<number, number[]>}
     */
    this.positions = new Map();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Compute a layout from scratch for every active node in `graph`.
   * Positions are initialised randomly, then refined for `this.iterations` steps.
   *
   * @param {DirectedGraph} graph
   * @returns {Map<number, number[]>} Map from node index to coordinate array.
   */
  compute(graph) {
    this._initPositions(graph);
    const t0 = this._initialTemperature();
    this._runIterations(graph, this.iterations, t0);
    return this.positions;
  }

  /**
   * Incrementally refine the layout after the graph topology has changed.
   *
   * - New nodes (indices not yet in `this.positions`) are seeded near their
   *   neighbours' centroid (or randomly if they have no neighbours yet).
   * - Deleted nodes are pruned from `this.positions`.
   * - A small number of additional iterations are run starting from a low
   *   temperature (so existing nodes shift only slightly).
   *
   * @param {DirectedGraph} graph
   * @param {number} [extraIterations=80] - How many refinement steps to run.
   */
  update(graph, extraIterations = 80) {
    const active = new Set(graph.getActiveNodes());

    // Prune deleted nodes
    for (const idx of this.positions.keys()) {
      if (!active.has(idx)) this.positions.delete(idx);
    }

    // Seed new nodes
    for (const idx of active) {
      if (!this.positions.has(idx)) {
        this.positions.set(idx, this._seedPosition(graph, idx));
      }
    }

    // Refine at a low temperature so existing positions barely move
    const lowTemp = this._initialTemperature() * 0.15;
    this._runIterations(graph, extraIterations, lowTemp);
  }

  /**
   * Return the position of a single node as a plain object { x, y } or { x, y, z }.
   * Throws if the node has no position (graph not yet laid out).
   *
   * @param {number} index
   * @returns {{ x: number, y: number, z?: number }}
   */
  getPosition(index) {
    const pos = this.positions.get(index);
    if (!pos) throw new Error(`layout.getPosition: node ${index} has no position.`);
    return this.dimensions === 3
      ? { x: pos[0], y: pos[1], z: pos[2] }
      : { x: pos[0], y: pos[1] };
  }

  /**
   * Return all positions as an array of plain objects, sorted by node index.
   * Each object has the form { index, x, y[, z] }.
   *
   * @returns {{ index: number, x: number, y: number, z?: number }[]}
   */
  getAllPositions() {
    return [...this.positions.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, pos]) => ({
        index,
        x: pos[0],
        y: pos[1],
        ...(this.dimensions === 3 ? { z: pos[2] } : {}),
      }));
  }

  // ── Live simulation (dynamic spatial adjustment) ──────────────────────────

  /**
   * Advance the layout by a few iterations at the current live temperature.
   * Call this every animation frame when dynamic spatial adjustment is enabled.
   * Temperature decays toward `liveFloor` so nodes settle without disappearing.
   *
   * @param {DirectedGraph} graph
   * @param {number} [iters=2]
   */
  tick(graph, iters = 2) {
    const floor = this.liveFloor * this.liveSpeedMultiplier;
    this._runIterations(graph, iters, Math.max(floor, this.liveTemperature));
    this.liveTemperature = Math.max(
      floor,
      this.liveTemperature * Math.pow(this.coolingFactor, iters)
    );
  }

  /**
   * Inject a small burst of energy after a topology change so the layout can
   * re-optimise the new neighbourhood without causing large jumps in existing nodes.
   */
  boostTemperature() {
    const s   = this.liveSpeedMultiplier;
    const max = this._initialTemperature() * 0.3  * s;
    this.liveTemperature = Math.min(max, this.liveTemperature + this._initialTemperature() * 0.15 * s);
  }

  // ── Internal — initialisation ─────────────────────────────────────────────

  /**
   * Place every active node at a random position within the layout bounding box.
   * Positions are stored as raw arrays for performance during the iteration loop.
   * @private
   */
  _initPositions(graph) {
    this.positions.clear();
    for (const idx of graph.getActiveNodes()) {
      this.positions.set(idx, this._randomPosition());
    }
  }

  /** @private */
  _randomPosition() {
    const pos = [
      (Math.random() - 0.5) * this.width,
      (Math.random() - 0.5) * this.height,
    ];
    if (this.dimensions === 3) pos.push((Math.random() - 0.5) * this.depth);
    return pos;
  }

  /**
   * Seed a newly added node near the centroid of its neighbours, or randomly
   * if it has no neighbours yet.
   * @private
   */
  _seedPosition(graph, index) {
    const neighbors = [
      ...graph.getOutNeighbors(index),
      ...graph.getInNeighbors(index),
    ].filter(n => this.positions.has(n));

    if (neighbors.length === 0) return this._randomPosition();

    const centroid = zeroVec(this.dimensions);
    for (const n of neighbors) vecAddInPlace(centroid, this.positions.get(n));
    const jitter = 5;
    return centroid.map(c => c / neighbors.length + (Math.random() - 0.5) * jitter);
  }

  // ── Internal — force computation ──────────────────────────────────────────

  /**
   * The "optimal" distance between connected nodes, derived from the area/volume
   * and the number of nodes (Fruchterman-Reingold formula).
   * @private
   */
  _optimalDistance(nodeCount) {
    const area = this.dimensions === 3
      ? this.width * this.height * this.depth
      : this.width * this.height;
    return Math.cbrt(area / Math.max(nodeCount, 1));
  }

  /** Initial temperature equals ~10% of the canvas size. @private */
  _initialTemperature() {
    return Math.max(this.width, this.height, this.depth) * 0.1;
  }

  /**
   * Run `count` Fruchterman-Reingold iterations starting at temperature `t`.
   * @private
   */
  _runIterations(graph, count, t) {
    const activeNodes = graph.getActiveNodes();
    const n = activeNodes.length;
    if (n < 2) return;

    const k = this._optimalDistance(n);
    const kSq = k * k;

    // Pre-cache the active-edge list for the inner loop
    const edges = graph.getEdges();

    for (let iter = 0; iter < count; iter++) {
      // --- Repulsive forces: every pair of nodes pushes apart ---
      const disp = new Map(activeNodes.map(i => [i, zeroVec(this.dimensions)]));

      for (let a = 0; a < activeNodes.length; a++) {
        const u = activeNodes[a];
        const pu = this.positions.get(u);
        for (let b = a + 1; b < activeNodes.length; b++) {
          const v = activeNodes[b];
          const pv = this.positions.get(v);
          const d = vecDist(pu, pv);
          // Repulsive force magnitude: k² / d
          const force = kSq / d;
          const delta = scaledDiff(pu, pv, force / d); // unit direction × force
          vecAddInPlace(disp.get(u), delta);
          vecAddInPlace(disp.get(v), delta.map(c => -c));
        }
      }

      // --- Attractive forces: edges pull endpoints together ---
      for (const [from, to] of edges) {
        if (!this.positions.has(from) || !this.positions.has(to)) continue;
        const pf = this.positions.get(from);
        const pt = this.positions.get(to);
        const d = vecDist(pf, pt);
        // Attractive force magnitude: d² / k
        const force = (d * d) / k;
        const delta = scaledDiff(pt, pf, force / d); // pulls from toward to
        vecAddInPlace(disp.get(from), delta);
        vecAddInPlace(disp.get(to), delta.map(c => -c));
      }

      // --- Apply displacements, clamped to temperature ---
      for (const u of activeNodes) {
        const pos = this.positions.get(u);
        const d = disp.get(u);
        clampMagnitude(d, t);
        vecAddInPlace(pos, d);
        // Keep nodes within the bounding box
        pos[0] = Math.max(-this.width  / 2, Math.min(this.width  / 2, pos[0]));
        pos[1] = Math.max(-this.height / 2, Math.min(this.height / 2, pos[1]));
        if (this.dimensions === 3) {
          pos[2] = Math.max(-this.depth / 2, Math.min(this.depth / 2, pos[2]));
        }
      }

      // Cool the system
      t *= this.coolingFactor;
    }
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ForceDirectedLayout };
} else {
  window.GraphCA = window.GraphCA || {};
  window.GraphCA.ForceDirectedLayout = ForceDirectedLayout;
}
