import assert from "node:assert";
import { describe, it } from "node:test";
import {
  addEdge,
  addNode,
  createDag,
  getNodes,
  getPredecessors,
  getSuccessors,
  removeEdge,
  removeNode,
  topologicalSort,
} from "./directed-acyclic-graph.js";

describe("DirectedAcyclicGraph", () => {
  describe("createDag", () => {
    it("creates an empty graph", () => {
      const dag = createDag<string>();
      assert.strictEqual(getNodes(dag).size, 0);
    });
  });

  describe("addNode", () => {
    it("adds a node to the graph", () => {
      const dag = createDag<string>();
      addNode(dag, "a");
      assert.deepStrictEqual([...getNodes(dag)], ["a"]);
    });

    it("adding duplicate node is idempotent", () => {
      const dag = createDag<string>();
      addNode(dag, "a");
      addNode(dag, "a");
      assert.deepStrictEqual([...getNodes(dag)], ["a"]);
    });
  });

  describe("addEdge", () => {
    it("adds a directed edge between nodes", () => {
      const dag = createDag<string>();
      addNode(dag, "a");
      addNode(dag, "b");
      addEdge(dag, "a", "b");
      assert.deepStrictEqual([...getSuccessors(dag, "a")], ["b"]);
      assert.strictEqual(getSuccessors(dag, "b").size, 0);
    });

    it("adding duplicate edge is idempotent", () => {
      const dag = createDag<string>();
      addNode(dag, "a");
      addNode(dag, "b");
      addEdge(dag, "a", "b");
      addEdge(dag, "a", "b");
      assert.deepStrictEqual([...getSuccessors(dag, "a")], ["b"]);
    });
  });

  describe("removeEdge", () => {
    it("removes a directed edge", () => {
      const dag = createDag<string>();
      addNode(dag, "a");
      addNode(dag, "b");
      addEdge(dag, "a", "b");
      removeEdge(dag, "a", "b");
      assert.strictEqual(getSuccessors(dag, "a").size, 0);
    });

    it("removing nonexistent edge is idempotent", () => {
      const dag = createDag<string>();
      addNode(dag, "a");
      addNode(dag, "b");
      removeEdge(dag, "a", "b");
      assert.strictEqual(getSuccessors(dag, "a").size, 0);
    });
  });

  describe("removeNode", () => {
    it("removes a node and all its edges", () => {
      const dag = createDag<string>();
      addNode(dag, "a");
      addNode(dag, "b");
      addNode(dag, "c");
      addEdge(dag, "a", "b");
      addEdge(dag, "b", "c");
      removeNode(dag, "b");
      assert.deepStrictEqual([...getNodes(dag)].sort(), ["a", "c"]);
      assert.strictEqual(getSuccessors(dag, "a").size, 0);
    });

    it("removing nonexistent node is idempotent", () => {
      const dag = createDag<string>();
      removeNode(dag, "nonexistent");
      assert.strictEqual(getNodes(dag).size, 0);
    });
  });

  describe("topologicalSort", () => {
    it("sorts a linear chain", () => {
      const dag = createDag<string>();
      addNode(dag, "a");
      addNode(dag, "b");
      addNode(dag, "c");
      addEdge(dag, "a", "b");
      addEdge(dag, "b", "c");
      assert.deepStrictEqual(topologicalSort(dag), ["a", "b", "c"]);
    });

    it("sorts a diamond graph", () => {
      const dag = createDag<string>();
      addNode(dag, "a");
      addNode(dag, "b");
      addNode(dag, "c");
      addNode(dag, "d");
      addEdge(dag, "a", "b");
      addEdge(dag, "a", "c");
      addEdge(dag, "b", "d");
      addEdge(dag, "c", "d");
      const sorted = topologicalSort(dag);
      assert.strictEqual(sorted[0], "a");
      assert.strictEqual(sorted[3], "d");
      assert.strictEqual(sorted.includes("b"), true);
      assert.strictEqual(sorted.includes("c"), true);
    });

    it("returns empty array for empty graph", () => {
      const dag = createDag<string>();
      assert.deepStrictEqual(topologicalSort(dag), []);
    });

    it("returns single node for single-node graph", () => {
      const dag = createDag<string>();
      addNode(dag, "a");
      assert.deepStrictEqual(topologicalSort(dag), ["a"]);
    });

    it("handles disconnected subgraphs", () => {
      const dag = createDag<string>();
      addNode(dag, "a");
      addNode(dag, "b");
      addNode(dag, "c");
      addEdge(dag, "a", "b");
      // c is disconnected
      const sorted = topologicalSort(dag);
      assert.strictEqual(sorted.indexOf("a") < sorted.indexOf("b"), true);
      assert.strictEqual(sorted.includes("c"), true);
    });

    it("uses comparator for deterministic tiebreaking", () => {
      const dag = createDag<string>();
      addNode(dag, "c");
      addNode(dag, "a");
      addNode(dag, "b");
      // No edges -- all unconstrained. Comparator determines order.
      const sorted = topologicalSort(dag, (a, b) => a.localeCompare(b));
      assert.deepStrictEqual(sorted, ["a", "b", "c"]);
    });

    it("comparator controls tiebreaking among unconstrained nodes", () => {
      const dag = createDag<string>();
      addNode(dag, "c");
      addNode(dag, "b");
      addNode(dag, "a");
      addNode(dag, "d");
      addEdge(dag, "a", "d"); // a before d, b and c unconstrained
      // Reverse alphabetical tiebreaker
      const sorted = topologicalSort(dag, (a, b) => b.localeCompare(a));
      assert.strictEqual(sorted.indexOf("a") < sorted.indexOf("d"), true);
      // Among unconstrained {a, b, c}, reverse alpha puts c, b, a
      // c > b > a in reverse alpha, so c first among ties
      assert.strictEqual(sorted[0], "c");
    });

    it("throws on cycle", () => {
      const dag = createDag<string>();
      addNode(dag, "a");
      addNode(dag, "b");
      addEdge(dag, "a", "b");
      addEdge(dag, "b", "a");
      assert.throws(
        () => topologicalSort(dag),
        (err: unknown) => {
          return (
            err instanceof Error &&
            err.message.includes("a") &&
            err.message.includes("b")
          );
        }
      );
    });

    it("throws on indirect cycle", () => {
      const dag = createDag<string>();
      addNode(dag, "a");
      addNode(dag, "b");
      addNode(dag, "c");
      addEdge(dag, "a", "b");
      addEdge(dag, "b", "c");
      addEdge(dag, "c", "a");
      assert.throws(
        () => topologicalSort(dag),
        (err: unknown) => {
          return (
            err instanceof Error &&
            err.message.includes("a") &&
            err.message.includes("b") &&
            err.message.includes("c")
          );
        }
      );
    });

    it("caches sort result when graph is unchanged", () => {
      const dag = createDag<string>();
      addNode(dag, "a");
      addNode(dag, "b");
      addEdge(dag, "a", "b");
      const first = topologicalSort(dag);
      const second = topologicalSort(dag);
      assert.strictEqual(first, second); // same reference
    });

    it("invalidates cache when node is added", () => {
      const dag = createDag<string>();
      addNode(dag, "a");
      const first = topologicalSort(dag);
      addNode(dag, "b");
      const second = topologicalSort(dag);
      assert.notStrictEqual(first, second);
    });

    it("invalidates cache when edge is added", () => {
      const dag = createDag<string>();
      addNode(dag, "a");
      addNode(dag, "b");
      const first = topologicalSort(dag);
      addEdge(dag, "a", "b");
      const second = topologicalSort(dag);
      assert.notStrictEqual(first, second);
    });

    it("invalidates cache when node is removed", () => {
      const dag = createDag<string>();
      addNode(dag, "a");
      addNode(dag, "b");
      const first = topologicalSort(dag);
      removeNode(dag, "b");
      const second = topologicalSort(dag);
      assert.notStrictEqual(first, second);
    });
  });

  describe("getPredecessors", () => {
    it("returns incoming neighbors of a node", () => {
      const dag = createDag<string>();
      addNode(dag, "a");
      addNode(dag, "b");
      addNode(dag, "c");
      addEdge(dag, "a", "c");
      addEdge(dag, "b", "c");
      assert.deepStrictEqual([...getPredecessors(dag, "c")].sort(), ["a", "b"]);
      assert.strictEqual(getPredecessors(dag, "a").size, 0);
    });
  });
});
