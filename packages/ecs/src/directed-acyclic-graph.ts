// ============================================================================
// Directed Acyclic Graph Types
// ============================================================================

/**
 * Generic directed acyclic graph.
 *
 * Stores nodes and directed edges with adjacency lists in both directions.
 * Provides topological sort with caller-supplied comparator for deterministic
 * tiebreaking. Cycle detection occurs during sort.
 *
 * @example
 * ```typescript
 * const dag = createDag<string>();
 * addNode(dag, "a");
 * addNode(dag, "b");
 * addEdge(dag, "a", "b");
 * const sorted = topologicalSort(dag); // ["a", "b"]
 * ```
 */
export type DirectedAcyclicGraph<N> = {
  /** @internal */
  nodes: Set<N>;
  /** @internal Forward adjacency: node -> Set of successors. */
  forward: Map<N, Set<N>>;
  /** @internal Reverse adjacency: node -> Set of predecessors. */
  reverse: Map<N, Set<N>>;
  /** @internal Cached topological sort result. */
  cachedSort: N[] | null;
};

// ============================================================================
// Graph Construction
// ============================================================================

/**
 * Create an empty directed acyclic graph.
 *
 * @example
 * ```typescript
 * const dag = createDag<string>();
 * ```
 */
export function createDag<N>(): DirectedAcyclicGraph<N> {
  return {
    nodes: new Set(),
    forward: new Map(),
    reverse: new Map(),
    cachedSort: null,
  };
}

/**
 * Add a node to the graph. Idempotent.
 *
 * @param dag - Graph instance
 * @param node - Node to add
 *
 * @example
 * ```typescript
 * addNode(dag, "physics");
 * ```
 */
export function addNode<N>(dag: DirectedAcyclicGraph<N>, node: N): void {
  if (dag.nodes.has(node)) {
    return;
  }

  dag.nodes.add(node);
  dag.forward.set(node, new Set());
  dag.reverse.set(node, new Set());

  dag.cachedSort = null;
}

/**
 * Add a directed edge from one node to another. Idempotent.
 * Both nodes must already exist in the graph.
 *
 * @param dag - Graph instance
 * @param from - Source node
 * @param to - Target node
 *
 * @example
 * ```typescript
 * addEdge(dag, "a", "b"); // a must run before b
 * ```
 */
export function addEdge<N>(dag: DirectedAcyclicGraph<N>, from: N, to: N): void {
  const fwd = dag.forward.get(from)!;

  if (fwd.has(to)) {
    return;
  }

  fwd.add(to);
  dag.reverse.get(to)!.add(from);

  dag.cachedSort = null;
}

// ============================================================================
// Graph Removal
// ============================================================================

/**
 * Remove a directed edge. Idempotent.
 *
 * @param dag - Graph instance
 * @param from - Source node
 * @param to - Target node
 *
 * @example
 * ```typescript
 * removeEdge(dag, "a", "b");
 * ```
 */
export function removeEdge<N>(dag: DirectedAcyclicGraph<N>, from: N, to: N): void {
  dag.forward.get(from)?.delete(to);
  dag.reverse.get(to)?.delete(from);

  dag.cachedSort = null;
}

/**
 * Remove a node and all its connected edges. Idempotent.
 *
 * @param dag - Graph instance
 * @param node - Node to remove
 *
 * @example
 * ```typescript
 * removeNode(dag, "obsolete");
 * ```
 */
export function removeNode<N>(dag: DirectedAcyclicGraph<N>, node: N): void {
  if (!dag.nodes.has(node)) {
    return;
  }

  // Remove all edges from this node
  const successors = dag.forward.get(node);

  if (successors) {
    for (const successor of successors) {
      dag.reverse.get(successor)!.delete(node);
    }
  }

  // Remove all edges to this node
  const predecessors = dag.reverse.get(node);

  if (predecessors) {
    for (const predecessor of predecessors) {
      dag.forward.get(predecessor)!.delete(node);
    }
  }

  dag.nodes.delete(node);
  dag.forward.delete(node);
  dag.reverse.delete(node);

  dag.cachedSort = null;
}

// ============================================================================
// Graph Queries
// ============================================================================

/** @internal */
const EMPTY_SET: ReadonlySet<never> = new Set();

/**
 * Get all nodes in the graph.
 *
 * @internal
 */
export function getNodes<N>(dag: DirectedAcyclicGraph<N>): ReadonlySet<N> {
  return dag.nodes;
}

/**
 * Get successors (outgoing neighbors) of a node.
 *
 * @internal
 */
export function getSuccessors<N>(dag: DirectedAcyclicGraph<N>, node: N): ReadonlySet<N> {
  return dag.forward.get(node) ?? (EMPTY_SET as ReadonlySet<N>);
}

/**
 * Get predecessors (incoming neighbors) of a node.
 *
 * @internal
 */
export function getPredecessors<N>(dag: DirectedAcyclicGraph<N>, node: N): ReadonlySet<N> {
  return dag.reverse.get(node) ?? (EMPTY_SET as ReadonlySet<N>);
}

// ============================================================================
// Topological Sort
// ============================================================================

/**
 * Binary insert into a sorted region of an array.
 * @internal
 */
function binaryInsert<N>(arr: N[], value: N, start: number, comparator: (a: N, b: N) => number): void {
  let low = start;
  let high = arr.length;

  while (low < high) {
    const mid = (low + high) >>> 1;

    if (comparator(arr[mid]!, value) <= 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  arr.splice(low, 0, value);
}

/**
 * Topological sort via Kahn's algorithm.
 *
 * Returns nodes in dependency order (sources first). Uses the optional
 * comparator for deterministic tiebreaking among nodes with no ordering
 * constraint. Results are cached until the graph is mutated.
 *
 * @param dag - Graph instance
 * @param comparator - Optional comparison function for tiebreaking
 * @returns Sorted array of nodes
 * @throws Error if the graph contains a cycle
 *
 * @example
 * ```typescript
 * const sorted = topologicalSort(dag, (a, b) => a.localeCompare(b));
 * ```
 */
export function topologicalSort<N>(dag: DirectedAcyclicGraph<N>, comparator?: (a: N, b: N) => number): N[] {
  if (dag.cachedSort !== null) {
    return dag.cachedSort;
  }

  // Build in-degree map
  const inDegree = new Map<N, number>();

  for (const node of dag.nodes) {
    inDegree.set(node, dag.reverse.get(node)!.size);
  }

  // Initialize queue with zero in-degree nodes
  const queue: N[] = [];

  for (const [node, degree] of inDegree) {
    if (degree === 0) {
      queue.push(node);
    }
  }

  if (comparator) {
    queue.sort(comparator);
  }

  const result: N[] = [];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++]!;
    result.push(current);

    const successors = dag.forward.get(current)!;

    for (const successor of successors) {
      const newDegree = inDegree.get(successor)! - 1;
      inDegree.set(successor, newDegree);

      if (newDegree === 0) {
        if (comparator) {
          binaryInsert(queue, successor, head, comparator);
        } else {
          queue.push(successor);
        }
      }
    }
  }

  if (result.length !== dag.nodes.size) {
    const remaining: N[] = [];

    for (const [node, degree] of inDegree) {
      if (degree > 0) remaining.push(node);
    }

    throw new Error(`${remaining}`);
  }

  dag.cachedSort = result;

  return result;
}
