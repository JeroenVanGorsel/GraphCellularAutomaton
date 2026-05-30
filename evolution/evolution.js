/**
 * evolution.js — Timestep-based random topology evolution for Graph CA.
 *
 * POSITION-STABILITY GUARANTEES
 * ──────────────────────────────
 * Graph uses stable tombstone indices: removeNode() marks a slot null but
 * never shifts other indices. ForceDirectedLayout stores positions in a Map
 * keyed by node index. Combining both:
 *
 *   REMOVE — graph.removeNode(i) invalidates only index i. We also call
 *             layout.positions.delete(i) to free memory. Every other index j
 *             (j ≠ i) and its position entry is left completely untouched.
 *
 *   ADD    — graph.addNode() always appends a fresh slot (never reuses
 *             tombstones). We compute a seed position for the new node from
 *             its neighbours' centroid and write it directly into
 *             layout.positions — no force iterations are run, so no existing
 *             node moves even by a pixel.
 *
 * Neither operation calls layout.compute() or layout.update(), guaranteeing
 * that all pre-existing nodes stay exactly where they are in 3-D space.
 */

const GraphEvolution = (() => {

  let _timerId   = null;
  let _stepCount = 0;

  // ── Tiny utilities ─────────────────────────────────────────────────────────

  function _randInt(n) { return Math.floor(Math.random() * n); }

  function _shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = _randInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function _randomState(valueType) {
    if (valueType === 'binary')  return Math.random() < 0.5 ? 0 : 1;
    if (valueType === 'integer') return Math.floor(Math.random() * 10);
    return parseFloat((Math.random() * 10).toFixed(2)); // float
  }

  // ── Position seeding ───────────────────────────────────────────────────────

  /**
   * Compute a starting position for a newly added node WITHOUT running any
   * force iterations. Mirrors ForceDirectedLayout._seedPosition but is called
   * here so we bypass layout.update() entirely.
   *
   * Strategy: place the new node at the centroid of its already-positioned
   * neighbours plus small random jitter. If it has no neighbours yet, place
   * it at a random location within the layout bounding box.
   *
   * @param {Graph}               graph
   * @param {ForceDirectedLayout} layout
   * @param {number}              index  - Index of the newly created node.
   * @returns {number[]} Raw coordinate array [x,y] or [x,y,z].
   */
  function _seedPosition(graph, layout, index) {
    const knownNeighbors = [
      ...graph.getOutNeighbors(index),
      ...graph.getInNeighbors(index),
    ].filter(n => layout.positions.has(n));

    if (knownNeighbors.length === 0) {
      // No neighbours yet — random position within the layout bounding box
      const pos = [
        (Math.random() - 0.5) * layout.width,
        (Math.random() - 0.5) * layout.height,
      ];
      if (layout.dimensions === 3) pos.push((Math.random() - 0.5) * layout.depth);
      return pos;
    }

    // Centroid of known neighbours + small jitter so the node doesn't land
    // exactly on top of another
    const dims     = layout.dimensions;
    const centroid = new Array(dims).fill(0);
    for (const n of knownNeighbors) {
      const p = layout.positions.get(n);
      for (let d = 0; d < dims; d++) centroid[d] += p[d];
    }
    const jitter = 10;
    return centroid.map(c => c / knownNeighbors.length + (Math.random() - 0.5) * jitter);
  }

  // ── Core topology operations ───────────────────────────────────────────────

  /**
   * Add one node with a random state and 1–3 random edges to existing nodes.
   * Seeds its position directly into layout.positions without any force pass.
   *
   * @param {Graph}               graph
   * @param {ForceDirectedLayout} layout
   * @returns {number} Index of the newly created node.
   */
  function addRandomNode(graph, layout) {
    const active = graph.getActiveNodes();

    // Compute the label before addNode so it matches the returned index.
    // graph.addNode appends to _nodes, so the new index == current length.
    const newIdx = graph.addNode({
      label: String(graph._nodes.length),
      state: _randomState(graph.valueType),
    });

    // Connect to 1–3 randomly chosen existing nodes.
    // For directed graphs the edge direction is randomised; for undirected /
    // bidirectional graphs addEdge already mirrors the reverse direction.
    const targets = _shuffle(active).slice(0, _randInt(3) + 1);
    for (const target of targets) {
      try {
        if (graph.type === 'directed' && Math.random() < 0.5) {
          graph.addEdge(target, newIdx); // existing → new
        } else {
          graph.addEdge(newIdx, target); // new → existing
        }
      } catch (_) { /* skip if target was already removed */ }
    }

    // Write position directly — no force iterations touch existing nodes.
    layout.positions.set(newIdx, _seedPosition(graph, layout, newIdx));

    return newIdx;
  }

  /**
   * Remove one randomly chosen active node and clean up its position entry.
   *
   * Because Graph tombstones rather than compacts, every other node index and
   * its entry in layout.positions remains completely valid after this call.
   *
   * @param {Graph}               graph
   * @param {ForceDirectedLayout} layout
   * @returns {number} Index of the removed node.
   */
  function removeRandomNode(graph, layout) {
    const active = graph.getActiveNodes();
    const idx    = active[_randInt(active.length)];

    graph.removeNode(idx);
    layout.positions.delete(idx); // free memory; index is now tombstoned

    return idx;
  }

  // ── Public step API ────────────────────────────────────────────────────────

  /**
   * Execute one evolution step: randomly add or remove a node.
   * Removal is suppressed when fewer than 3 active nodes remain.
   *
   * @param {Graph}               graph
   * @param {ForceDirectedLayout} layout
   * @returns {{ action: 'add'|'remove', nodeIndex: number }}
   */
  function step(graph, layout) {
    const active    = graph.getActiveNodes();
    const canRemove = active.length > 2;
    const doAdd     = !canRemove || Math.random() < 0.5;

    _stepCount++;

    if (doAdd) {
      return { action: 'add',    nodeIndex: addRandomNode(graph, layout) };
    } else {
      return { action: 'remove', nodeIndex: removeRandomNode(graph, layout) };
    }
  }

  // ── Auto-loop API ──────────────────────────────────────────────────────────

  /**
   * Start the automatic evolution loop.
   *
   * @param {Graph}               graph
   * @param {ForceDirectedLayout} layout
   * @param {Object}              [opts]
   * @param {number}              [opts.intervalMs=1000]   Milliseconds between steps.
   * @param {function}            [opts.onStep]            Called with (result, stepCount).
   */
  function start(graph, layout, { intervalMs = 1000, onStep } = {}) {
    stop(); // clear any existing timer before starting a new one
    _timerId = setInterval(() => {
      const result = step(graph, layout);
      if (onStep) onStep(result, _stepCount);
    }, intervalMs);
  }

  /** Stop the automatic evolution loop. */
  function stop() {
    if (_timerId !== null) { clearInterval(_timerId); _timerId = null; }
  }

  /** @returns {boolean} True while the auto-loop is running. */
  function isRunning() { return _timerId !== null; }

  /** @returns {number} Total steps executed since last resetStepCount(). */
  function getStepCount() { return _stepCount; }

  /** Reset the step counter (call this from resetGraph). */
  function resetStepCount() { _stepCount = 0; }

  // ── Export ─────────────────────────────────────────────────────────────────

  return {
    step,
    start,
    stop,
    isRunning,
    getStepCount,
    resetStepCount,
    addRandomNode,
    removeRandomNode,
  };
})();

// Browser global + optional CommonJS export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GraphEvolution };
} else {
  window.GraphCA        = window.GraphCA || {};
  window.GraphCA.GraphEvolution = GraphEvolution;
  window.GraphEvolution = GraphEvolution; // convenience alias used by index.html
}
