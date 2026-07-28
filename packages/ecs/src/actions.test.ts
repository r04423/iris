import assert from "node:assert";
import { describe, it } from "node:test";
import { defineActions } from "./actions.js";
import { createEntity, isEntityAlive } from "./entity.js";
import { addSystem, defineSystem, runOnce } from "./scheduler.js";
import { createWorld, resetWorld } from "./world.js";

describe("Actions", () => {
  describe("World Binding", () => {
    it("invokes the initializer with the bound world", () => {
      const testActions = defineActions((world) => ({
        spawn: () => createEntity(world),
      }));

      const world = createWorld();
      const other = createWorld();

      const entity = testActions(world).spawn();

      assert.strictEqual(isEntityAlive(world, entity), true);
      assert.strictEqual(isEntityAlive(other, entity), false);
    });
  });

  describe("Caching", () => {
    it("same world returns identical actions object", () => {
      const testActions = defineActions((world) => ({
        noop(): void {
          void world;
        },
      }));

      const world = createWorld();

      const first = testActions(world);
      const second = testActions(world);
      const third = testActions(world);

      assert.strictEqual(first, second);
      assert.strictEqual(second, third);
    });

    it("initializer runs once per world", () => {
      let totalInits = 0;

      const testActions = defineActions((world) => {
        totalInits++;
        return {
          noop(): void {
            void world;
          },
        };
      });

      const world1 = createWorld();
      const world2 = createWorld();
      const world3 = createWorld();

      testActions(world1);
      testActions(world1);
      testActions(world2);
      testActions(world2);
      testActions(world3);

      assert.strictEqual(totalInits, 3);
    });

    it("different worlds get different actions objects", () => {
      const testActions = defineActions((world) => ({
        noop(): void {
          void world;
        },
      }));

      const world1 = createWorld();
      const world2 = createWorld();

      assert.notStrictEqual(testActions(world1), testActions(world2));
    });

    it("different initializers create independent caches", () => {
      const actionsA = defineActions(() => ({
        noop(): void {},
      }));

      const actionsB = defineActions(() => ({
        noop(): void {},
      }));

      const world = createWorld();

      assert.notStrictEqual(actionsA(world), actionsB(world));
    });
  });

  describe("World Reset", () => {
    it("reinitializes closure state retained by a system after reset", async () => {
      const counterActions = defineActions(() => {
        let count = 0;
        return {
          next(): number {
            return ++count;
          },
        };
      });
      const world = createWorld();
      const values: number[] = [];

      addSystem(
        world,
        defineSystem("actionCounter", (systemWorld) => {
          const counter = counterActions(systemWorld);
          return () => {
            values.push(counter.next());
          };
        })
      );

      await runOnce(world);
      await runOnce(world);
      resetWorld(world);
      await runOnce(world);

      assert.deepStrictEqual(values, [1, 2, 1]);
    });
  });

  describe("Edge Cases", () => {
    it("handles empty actions object", () => {
      const emptyActions = defineActions(() => {
        return {};
      });

      const world = createWorld();
      const actions = emptyActions(world);

      assert.deepStrictEqual(Object.keys(actions), []);
    });
  });
});
