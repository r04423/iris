import assert from "node:assert";
import { describe, it } from "node:test";
import { IrisRevisionOverflow } from "./error.js";
import { consumeRevisionWindow, inRevisionWindow, resetRevision } from "./revision.js";
import { createWorld } from "./world.js";

describe("Revision", () => {
  describe("resetRevision", () => {
    it("restores the initial clock value", () => {
      const world = createWorld();
      consumeRevisionWindow(world, new Map(), "sys", world.revision);

      resetRevision(world);

      assert.strictEqual(world.revision, 1);
    });
  });

  describe("consumeRevisionWindow", () => {
    it("returns zero for a system with no cursor", () => {
      const world = createWorld();

      assert.strictEqual(consumeRevisionWindow(world, new Map(), "sys", world.revision), 0);
    });

    it("returns the previous cursor on subsequent consumption", () => {
      const world = createWorld();
      const cursors = new Map<string, number>();

      const first = world.revision;
      consumeRevisionWindow(world, cursors, "sys", first);

      assert.strictEqual(consumeRevisionWindow(world, cursors, "sys", world.revision), first);
    });

    it("records the boundary as the system's cursor", () => {
      const world = createWorld();
      const cursors = new Map<string, number>();

      consumeRevisionWindow(world, cursors, "sys", world.revision);

      assert.strictEqual(cursors.get("sys"), 1);
    });

    it("advances the world revision past the boundary", () => {
      const world = createWorld();

      consumeRevisionWindow(world, new Map(), "sys", world.revision);

      assert.strictEqual(world.revision, 2);
    });

    it("tracks cursors per system independently", () => {
      const world = createWorld();
      const cursors = new Map<string, number>();

      consumeRevisionWindow(world, cursors, "a", world.revision);

      assert.strictEqual(consumeRevisionWindow(world, cursors, "b", world.revision), 0);
    });

    it("throws when the revision counter is exhausted", () => {
      const world = createWorld();
      world.revision = Number.MAX_SAFE_INTEGER;

      assert.throws(() => consumeRevisionWindow(world, new Map(), "sys", world.revision), IrisRevisionOverflow);
    });
  });

  describe("inRevisionWindow", () => {
    it("excludes the lower bound", () => {
      assert.strictEqual(inRevisionWindow(5, 5, 10), false);
    });

    it("includes the upper bound", () => {
      assert.strictEqual(inRevisionWindow(10, 5, 10), true);
    });

    it("includes stamps strictly inside the window", () => {
      assert.strictEqual(inRevisionWindow(7, 5, 10), true);
    });

    it("excludes stamps past the boundary", () => {
      assert.strictEqual(inRevisionWindow(11, 5, 10), false);
    });
  });
});
