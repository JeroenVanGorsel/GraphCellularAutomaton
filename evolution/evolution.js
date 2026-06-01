/**
 * evolution.js — Timestep-based evolution for Graph CA.
 *
 * Supports two modes:
 *   Random (legacy) — at every step a node is randomly added or removed.
 *   Rule-based      — a rules config object drives state updates, births, and
 *                     removals independently, enabling deterministic GCA dynamics.
 *
 * POSITION-STABILITY GUARANTEES
 * ──────────────────────────────
 * Graph uses stable tombstone indices: removeNode() marks a slot null but
 * never shifts other indices. ForceDirectedLayout stores positions in a Map
 * keyed by node index. Combining both:
 *
 *   REMOVE — graph.removeNode(i) invalidates only index i. We also call
 *             layout.positions.delete(i) to free memory.
 *   ADD    — graph.addNode() always appends a fresh slot. We compute a seed
 *             position for the new node from its neighbours' centroid and write
 *             it directly into layout.positions — no force iterations run.
 *
 * RULES CONFIG SHAPE
 * ──────────────────
 * {
 *   stateRule:   { type: 'none'|'interval'|'fractionalThreshold'|'majorityVote'|'lenia'|'reactionDiffusion', ...params }
 *   birthRule:   { type: 'none'|'random'|'division'|'preferentialAttachment'|'triangleClosing'|'poisson', ...params }
 *   removalRule: { type: 'none'|'random'|'stateCondition'|'degreeZero'|'poisson'|'adaptiveShedding', ...params }
 *   minNodes:    number  (default 3 — removals stop when graph shrinks to this)
 * }
 * Passing null/undefined rules falls back to legacy random mode.
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
    return parseFloat((Math.random() * 10).toFixed(2));
  }

  // ── Position seeding ───────────────────────────────────────────────────────

  function _seedPosition(graph, layout, index) {
    const knownNeighbors = graph.getNeighbors(index)
      .filter(n => layout.positions.has(n));

    if (knownNeighbors.length === 0) {
      const pos = [
        (Math.random() - 0.5) * layout.width,
        (Math.random() - 0.5) * layout.height,
      ];
      if (layout.dimensions === 3) pos.push((Math.random() - 0.5) * layout.depth);
      return pos;
    }

    const dims     = layout.dimensions;
    const centroid = new Array(dims).fill(0);
    for (const n of knownNeighbors) {
      const p = layout.positions.get(n);
      for (let d = 0; d < dims; d++) centroid[d] += p[d];
    }
    const jitter = 10;
    return centroid.map(c => c / knownNeighbors.length + (Math.random() - 0.5) * jitter);
  }

  // ── Core topology operations (preserved from legacy) ───────────────────────

  function addRandomNode(graph, layout) {
    const active = graph.getActiveNodes();
    const newIdx = graph.addNode({
      label: String(graph._nodes.length),
      state: _randomState(graph.valueType),
    });
    const targets = _shuffle(active).slice(0, _randInt(3) + 1);
    for (const target of targets) {
      try {
        if (graph.type === 'directed' && Math.random() < 0.5) {
          graph.addEdge(target, newIdx);
        } else {
          graph.addEdge(newIdx, target);
        }
      } catch (_) {}
    }
    layout.positions.set(newIdx, _seedPosition(graph, layout, newIdx));
    return newIdx;
  }

  function removeRandomNode(graph, layout) {
    const active = graph.getActiveNodes();
    const idx    = active[_randInt(active.length)];
    graph.removeNode(idx);
    layout.positions.delete(idx);
    return idx;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STATE RULES — update every node's value based on its neighbourhood
  // ══════════════════════════════════════════════════════════════════════════

  function _applyStateRule(graph, stateRule) {
    if (!stateRule || stateRule.type === 'none') return;
    switch (stateRule.type) {
      case 'interval':            return _stateInterval(graph, stateRule);
      case 'fractionalThreshold': return _stateFractional(graph, stateRule);
      case 'majorityVote':        return _stateMajority(graph);
      case 'lenia':               return _stateLenia(graph, stateRule);
      case 'reactionDiffusion':   return _stateRD(graph, stateRule);
    }
  }

  // Interval / Conway-style ─────────────────────────────────────────────────
  // Standard B/S notation: birth if live-neighbour count ∈ birthSet,
  // survive if live-neighbour count ∈ surviveSet.
  // Sets are arrays of integers, e.g. [3] for B3, [2,3] for S23, [3,6] for B36.
  // Using sets (not intervals) lets us express non-contiguous rules like HighLife
  // (birth at 3 OR 6, not 4 or 5) and Day & Night without approximation.
  function _stateInterval(graph, {
    birthSet   = [3],
    surviveSet = [2, 3],
  }) {
    const bSet    = new Set(birthSet);
    const sSet    = new Set(surviveSet);
    const active  = graph.getActiveNodes();
    const updates = [];
    for (const idx of active) {
      const node      = graph.getNode(idx);
      const neighbors = graph.getNeighbors(idx);
      const liveCount = neighbors.filter(n => graph.getNode(n)?.state === 1).length;
      const alive     = node.state === 1;
      const next      = alive ? (sSet.has(liveCount) ? 1 : 0)
                               : (bSet.has(liveCount) ? 1 : 0);
      updates.push([idx, next]);
    }
    for (const [idx, s] of updates) graph.getNode(idx).state = s;
  }

  // Fractional threshold ────────────────────────────────────────────────────
  // Node becomes alive if (live neighbours / total neighbours) > threshold κ.
  // Topology-invariant: hubs and leaves see equivalent proportional rules.
  function _stateFractional(graph, { threshold = 0.3 }) {
    const active  = graph.getActiveNodes();
    const updates = [];
    for (const idx of active) {
      const neighbors = graph.getNeighbors(idx);
      if (neighbors.length === 0) continue;
      const liveCount = neighbors.filter(n => graph.getNode(n)?.state === 1).length;
      updates.push([idx, liveCount / neighbors.length > threshold ? 1 : 0]);
    }
    for (const [idx, s] of updates) graph.getNode(idx).state = s;
  }

  // Majority vote ───────────────────────────────────────────────────────────
  // Node takes state 1 if more than half its neighbours are alive.
  function _stateMajority(graph) {
    const active  = graph.getActiveNodes();
    const updates = [];
    for (const idx of active) {
      const neighbors = graph.getNeighbors(idx);
      if (neighbors.length === 0) continue;
      const liveCount = neighbors.filter(n => graph.getNode(n)?.state === 1).length;
      updates.push([idx, liveCount > neighbors.length / 2 ? 1 : 0]);
    }
    for (const [idx, s] of updates) graph.getNode(idx).state = s;
  }

  // Lenia (continuous) ──────────────────────────────────────────────────────
  // States are real values in [0,1]. The neighbourhood average is passed
  // through a Gaussian bell curve; the resulting "growth signal" nudges each
  // node's own value up or down by dt each step.
  function _stateLenia(graph, { dt = 0.1, mu = 0.15, sigma = 0.015 }) {
    const bell    = x => Math.exp(-0.5 * ((x - mu) / sigma) ** 2);
    const active  = graph.getActiveNodes();
    const updates = [];
    for (const idx of active) {
      const node      = graph.getNode(idx);
      const state     = node.state ?? 0;
      const neighbors = graph.getNeighbors(idx);
      if (neighbors.length === 0) { updates.push([idx, state]); continue; }
      const avg    = neighbors.reduce((s, n) => s + (graph.getNode(n)?.state ?? 0), 0) / neighbors.length;
      const growth = 2 * bell(avg) - 1; // maps bell ∈ [0,1] → growth ∈ [-1,+1]
      updates.push([idx, Math.max(0, Math.min(1, state + dt * growth))]);
    }
    for (const [idx, s] of updates) graph.getNode(idx).state = s;
  }

  // Reaction-diffusion (Gray-Scott) ─────────────────────────────────────────
  // Each node carries concentrations u (activator) and v (inhibitor).
  // du/dt = Du·Lap(u) − u·v² + f·(1−u)
  // dv/dt = Dv·Lap(v) + u·v² − (f+k)·v
  // The graph Laplacian is approximated as the average of neighbour values
  // minus the node's own value. node.state is set to u for visualisation.
  function _stateRD(graph, { Du = 0.16, Dv = 0.08, f = 0.035, k = 0.065 }) {
    const active = graph.getActiveNodes();
    // Initialise u/v on first encounter
    for (const idx of active) {
      const node = graph.getNode(idx);
      if (node.u === undefined) {
        node.u = 1.0;
        node.v = Math.random() < 0.1 ? 0.5 + Math.random() * 0.5 : 0.0;
      }
    }
    const updates = [];
    for (const idx of active) {
      const node      = graph.getNode(idx);
      const neighbors = graph.getNeighbors(idx);
      let lapU = 0, lapV = 0;
      if (neighbors.length > 0) {
        for (const n of neighbors) {
          const nb = graph.getNode(n);
          lapU += (nb?.u ?? 1.0) - node.u;
          lapV += (nb?.v ?? 0.0) - node.v;
        }
        lapU /= neighbors.length;
        lapV /= neighbors.length;
      }
      const uvv  = node.u * node.v * node.v;
      const newU = Math.max(0, Math.min(1, node.u + Du * lapU - uvv + f * (1 - node.u)));
      const newV = Math.max(0, Math.min(1, node.v + Dv * lapV + uvv - (f + k) * node.v));
      updates.push([idx, newU, newV]);
    }
    for (const [idx, u, v] of updates) {
      const node = graph.getNode(idx);
      node.u = u; node.v = v;
      node.state = u;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BIRTH RULES — add new nodes to the graph
  // ══════════════════════════════════════════════════════════════════════════

  function _applyBirthRule(graph, layout, birthRule) {
    if (!birthRule || birthRule.type === 'none') return [];
    switch (birthRule.type) {
      case 'random':                return _birthRandom(graph, layout, birthRule);
      case 'division':              return _birthDivision(graph, layout, birthRule);
      case 'preferentialAttachment':return _birthPreferential(graph, layout, birthRule);
      case 'triangleClosing':       return _birthTriangle(graph, layout, birthRule);
      case 'poisson':               return _birthPoisson(graph, layout, birthRule);
      default: return [];
    }
  }

  // Random birth ─────────────────────────────────────────────────────────────
  function _birthRandom(graph, layout, { probability = 0.5 }) {
    if (Math.random() < probability) return [addRandomNode(graph, layout)];
    return [];
  }

  // Cell Division (GRA) ──────────────────────────────────────────────────────
  // A node whose state equals divisionState spawns a daughter node that
  // inherits all of the parent's edges. One division per step at most.
  function _birthDivision(graph, layout, { divisionState = 1, triggerProbability = 0.1 }) {
    const active  = graph.getActiveNodes();
    const parents = _shuffle(active.filter(idx => graph.getNode(idx).state === divisionState));
    for (const parentIdx of parents) {
      if (Math.random() > triggerProbability) continue;
      const neighbors = graph.getNeighbors(parentIdx);
      const newIdx = graph.addNode({
        label: String(graph._nodes.length),
        state: graph.getNode(parentIdx).state,
      });
      // Inherit edges from parent; connect back to parent as well
      try { graph.addEdge(parentIdx, newIdx); } catch (_) {}
      for (const n of neighbors) {
        try { graph.addEdge(newIdx, n); } catch (_) {}
        if (graph.type !== 'directed') try { graph.addEdge(n, newIdx); } catch (_) {}
      }
      layout.positions.set(newIdx, _seedPosition(graph, layout, newIdx));
      return [newIdx];
    }
    return [];
  }

  // Preferential attachment ──────────────────────────────────────────────────
  // New node attaches to existing nodes with probability proportional to degree,
  // naturally growing hubs (Barabási-Albert style).
  function _birthPreferential(graph, layout, { numEdges = 2 }) {
    const active = graph.getActiveNodes();
    if (active.length === 0) return [];

    const degrees   = active.map(idx => ({
      idx,
      degree: Math.max(1, graph.getNeighbors(idx).length),
    }));

    const targets   = [];
    const available = [...degrees];
    for (let i = 0; i < Math.min(numEdges, active.length); i++) {
      let total = available.reduce((s, d) => s + d.degree, 0);
      if (total === 0) break;
      let r = Math.random() * total;
      for (let j = 0; j < available.length; j++) {
        r -= available[j].degree;
        if (r <= 0) {
          targets.push(available[j].idx);
          available.splice(j, 1);
          break;
        }
      }
    }

    const newIdx = graph.addNode({
      label: String(graph._nodes.length),
      state: _randomState(graph.valueType),
    });
    for (const target of targets) {
      try { graph.addEdge(newIdx, target); } catch (_) {}
    }
    layout.positions.set(newIdx, _seedPosition(graph, layout, newIdx));
    return [newIdx];
  }

  // Triangle closing ─────────────────────────────────────────────────────────
  // A new node is placed between two live nodes that share no common neighbour,
  // closing the gap and stabilising a local cluster.
  function _birthTriangle(graph, layout, { probability = 0.1 }) {
    if (Math.random() > probability) return [];
    const active    = graph.getActiveNodes();
    const liveNodes = active.filter(idx => graph.getNode(idx).state === 1);
    if (liveNodes.length < 2) return [];

    for (let attempt = 0; attempt < 20; attempt++) {
      const i = liveNodes[_randInt(liveNodes.length)];
      const j = liveNodes[_randInt(liveNodes.length)];
      if (i === j) continue;
      const iN    = new Set(graph.getNeighbors(i));
      const jN    = new Set(graph.getNeighbors(j));
      const share = [...iN].filter(n => jN.has(n));
      if (share.length === 0 && !iN.has(j)) {
        const newIdx = graph.addNode({ label: String(graph._nodes.length), state: 1 });
        try { graph.addEdge(i, newIdx); } catch (_) {}
        try { graph.addEdge(newIdx, j); } catch (_) {}
        layout.positions.set(newIdx, _seedPosition(graph, layout, newIdx));
        return [newIdx];
      }
    }
    return [];
  }

  // Poisson birth ────────────────────────────────────────────────────────────
  function _birthPoisson(graph, layout, { birthRate = 0.1 }) {
    if (Math.random() < birthRate) return [addRandomNode(graph, layout)];
    return [];
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REMOVAL RULES — delete nodes from the graph
  // ══════════════════════════════════════════════════════════════════════════

  function _applyRemovalRule(graph, layout, removalRule, minNodes) {
    if (!removalRule || removalRule.type === 'none') return [];
    if (graph.getActiveNodes().length <= minNodes) return [];
    switch (removalRule.type) {
      case 'random':          return _removeRandom(graph, layout, removalRule, minNodes);
      case 'stateCondition':  return _removeStateCondition(graph, layout, removalRule, minNodes);
      case 'degreeZero':      return _removeDegreeZero(graph, layout, minNodes);
      case 'poisson':         return _removePoisson(graph, layout, removalRule, minNodes);
      case 'adaptiveShedding':return _removeAdaptive(graph, layout, removalRule, minNodes);
      default: return [];
    }
  }

  // Random removal ───────────────────────────────────────────────────────────
  function _removeRandom(graph, layout, { probability = 0.5 }, minNodes) {
    const active = graph.getActiveNodes();
    if (active.length <= minNodes || Math.random() > probability) return [];
    const idx = active[_randInt(active.length)];
    graph.removeNode(idx);
    layout.positions.delete(idx);
    return [idx];
  }

  // State-condition annihilation ─────────────────────────────────────────────
  // A node that has been in deadState for ≥ deadStreak consecutive steps AND
  // has all neighbours also dead (or is isolated) is removed.
  function _removeStateCondition(graph, layout, { deadState = 0, deadStreak = 3 }, minNodes) {
    const active  = graph.getActiveNodes();
    const removed = [];
    for (const idx of active) {
      if (active.length - removed.length <= minNodes) break;
      const node = graph.getNode(idx);
      if (node.state === deadState) {
        node._deadStreak = (node._deadStreak || 0) + 1;
        if (node._deadStreak >= deadStreak) {
          const neighbors = graph.getNeighbors(idx);
          const allDead   = neighbors.every(n => graph.getNode(n)?.state === deadState);
          if (allDead || neighbors.length === 0) {
            graph.removeNode(idx);
            layout.positions.delete(idx);
            removed.push(idx);
          }
        }
      } else {
        node._deadStreak = 0;
      }
    }
    return removed;
  }

  // Degree-zero removal ──────────────────────────────────────────────────────
  // Any isolated node (no edges at all) is immediately pruned.
  function _removeDegreeZero(graph, layout, minNodes) {
    const active  = graph.getActiveNodes();
    const removed = [];
    for (const idx of active) {
      if (active.length - removed.length <= minNodes) break;
      if (!graph._nodes[idx]) continue; // already tombstoned this step
      if (graph.getNeighbors(idx).length === 0) {
        graph.removeNode(idx);
        layout.positions.delete(idx);
        removed.push(idx);
      }
    }
    return removed;
  }

  // Poisson removal ──────────────────────────────────────────────────────────
  // Each node is independently removed with a per-step probability that depends
  // on its state: dead nodes die faster than alive ones.
  function _removePoisson(graph, layout, { deathRate = 0.05, deathRateAlive = 0.01 }, minNodes) {
    const active  = graph.getActiveNodes();
    const removed = [];
    for (const idx of _shuffle(active)) {
      if (active.length - removed.length <= minNodes) break;
      if (!graph._nodes[idx]) continue;
      const node = graph.getNode(idx);
      const rate = node.state === 1 ? deathRateAlive : deathRate;
      if (Math.random() < rate) {
        graph.removeNode(idx);
        layout.positions.delete(idx);
        removed.push(idx);
      }
    }
    return removed;
  }

  // Adaptive link shedding (Bornholdt-Rohlf) ────────────────────────────────
  // Active (state=1) nodes shed edges at rate shedRate.
  // Frozen (state=0) nodes gain new edges at rate gainRate.
  // Nodes that reach degree zero are pruned. This self-organises toward
  // dynamical criticality without manual parameter tuning.
  function _removeAdaptive(graph, layout, { shedRate = 0.1, gainRate = 0.05 }, minNodes) {
    const active  = graph.getActiveNodes();
    const removed = [];

    for (const idx of active) {
      if (!graph._nodes[idx]) continue;
      const node = graph.getNode(idx);
      if (node.state === 1) {
        // Active: shed outgoing edges stochastically
        for (const n of [...graph.getOutNeighbors(idx)]) {
          if (Math.random() < shedRate) {
            try { graph.removeEdge(idx, n); } catch (_) {}
          }
        }
      } else {
        // Frozen: randomly gain up to 2 new edges
        const candidates = _shuffle(active.filter(n => n !== idx && !graph.hasEdge(idx, n)));
        for (const n of candidates.slice(0, 2)) {
          if (Math.random() < gainRate) {
            try { graph.addEdge(idx, n); } catch (_) {}
          }
        }
      }
    }

    // Prune any nodes that became isolated
    for (const idx of active) {
      if (active.length - removed.length <= minNodes) break;
      if (!graph._nodes[idx]) continue;
      if (graph.getNeighbors(idx).length === 0) {
        graph.removeNode(idx);
        layout.positions.delete(idx);
        removed.push(idx);
      }
    }
    return removed;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC STEP API
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Execute one evolution step.
   *
   * When `rules` is null/undefined the legacy random add-or-remove behaviour
   * is used (backward compatible with existing callers).
   *
   * When `rules` is provided the step runs in three phases:
   *   1. Apply state rule to all nodes simultaneously.
   *   2. Apply birth rule  (may add nodes).
   *   3. Apply removal rule (may remove nodes, respecting minNodes floor).
   *
   * @param {Graph}               graph
   * @param {ForceDirectedLayout} layout
   * @param {Object|null}         [rules]
   * @returns {{ action: string, added: number[], removed: number[] }
   *          |{ action: 'add'|'remove', nodeIndex: number }}
   */
  function step(graph, layout, rules) {
    _stepCount++;

    // ── Legacy random mode ────────────────────────────────────────────────
    if (!rules) {
      const active    = graph.getActiveNodes();
      const canRemove = active.length > 2;
      const doAdd     = !canRemove || Math.random() < 0.5;
      if (doAdd) {
        return { action: 'add',    nodeIndex: addRandomNode(graph, layout) };
      } else {
        return { action: 'remove', nodeIndex: removeRandomNode(graph, layout) };
      }
    }

    // ── Rule-based mode ───────────────────────────────────────────────────
    const minNodes = rules.minNodes ?? 3;

    _applyStateRule(graph, rules.stateRule);

    const added   = _applyBirthRule(graph, layout, rules.birthRule);
    const removed = _applyRemovalRule(graph, layout, rules.removalRule, minNodes);

    return { action: 'rules', added, removed };
  }

  // ── Auto-loop API ──────────────────────────────────────────────────────────

  /**
   * Start the automatic evolution loop.
   *
   * @param {Graph}               graph
   * @param {ForceDirectedLayout} layout
   * @param {Object}              [opts]
   * @param {number}              [opts.intervalMs=1000]
   * @param {function}            [opts.onStep]  Called with (result, stepCount).
   * @param {Object|null}         [opts.rules]   GCA rules config; null = random.
   */
  function start(graph, layout, { intervalMs = 1000, onStep, rules = null } = {}) {
    stop();
    _timerId = setInterval(() => {
      const result = step(graph, layout, rules);
      if (onStep) onStep(result, _stepCount);
    }, intervalMs);
  }

  function stop() {
    if (_timerId !== null) { clearInterval(_timerId); _timerId = null; }
  }

  function isRunning()    { return _timerId !== null; }
  function getStepCount() { return _stepCount; }
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GraphEvolution };
} else {
  window.GraphCA        = window.GraphCA || {};
  window.GraphCA.GraphEvolution = GraphEvolution;
  window.GraphEvolution = GraphEvolution;
}
