import assert from "node:assert";
import { describe, it } from "node:test";

import { addComponent, hasComponent } from "./component.js";
import { createEntity, isEntityAlive } from "./entity.js";
import { IrisInvalidState } from "./error.js";
import { defineEvent, emitEvent } from "./event.js";
import { lookupByName, setName } from "./name.js";
import { registerObserverCallback } from "./observer.js";
import { collectEntities } from "./query.js";
import { defineComponent } from "./registry.js";
import {
  addSystem,
  defineSchedule,
  defineSystem,
  First,
  insertScheduleBefore,
  Last,
  PostUpdate,
  PreUpdate,
  runOnce,
  Update,
} from "./scheduler.js";
import { Type } from "./schema.js";
import { createWorld, resetWorld } from "./world.js";

describe("World", () => {
  describe("World Creation", () => {
    it("creates an empty world ready for use", () => {
      const world = createWorld();
      const Tag = defineComponent("CreationReady");

      assert.deepStrictEqual(collectEntities(world, [Tag]), []);

      const entity = createEntity(world);
      addComponent(world, entity, Tag);

      assert.deepStrictEqual(collectEntities(world, [Tag]), [entity]);
    });
  });

  describe("Multiple Worlds", () => {
    it("creates isolated worlds", () => {
      const world1 = createWorld();
      const world2 = createWorld();

      assert.notStrictEqual(world1.entities, world2.entities);
      assert.notStrictEqual(world1.archetypes, world2.archetypes);
    });
  });

  describe("World Reset", () => {
    it("clears all entities", () => {
      const world = createWorld();
      const Tag = defineComponent("ResetTest1");

      const entity = createEntity(world);
      addComponent(world, entity, Tag);

      // Entity exists before reset
      assert.ok(hasComponent(world, entity, Tag));

      resetWorld(world);

      assert.strictEqual(world.entities.byId.size, 0);
      assert.strictEqual(world.entities.byRawId.length, 0);
    });

    it("preserves registered systems and their built schedule after reset", async () => {
      const world = createWorld();
      let runs = 0;

      addSystem(
        world,
        defineSystem("testSystem", () => void runs++)
      );

      await runOnce(world);
      resetWorld(world);
      await runOnce(world);

      assert.strictEqual(runs, 2);
    });

    it("rebuilds an already-dirty schedule after reset", async () => {
      const world = createWorld();
      const calls: string[] = [];

      addSystem(
        world,
        defineSystem("existing", () => void calls.push("existing"))
      );
      await runOnce(world);

      addSystem(
        world,
        defineSystem("addedBeforeReset", () => void calls.push("added"))
      );
      resetWorld(world);
      await runOnce(world);

      assert.deepStrictEqual(calls, ["existing", "existing", "added"]);
    });

    it("clears queries and filters", () => {
      const world = createWorld();
      const Tag = defineComponent("ResetTest2");

      const entity = createEntity(world);
      addComponent(world, entity, Tag);

      // Create query (populates filter and query registries)
      const results = collectEntities(world, [Tag]);
      assert.strictEqual(results.length, 1);
      assert.ok(world.filters.byId.size > 0);
      assert.ok(world.queries.byId.size > 0);

      resetWorld(world);

      // Queries and filters cleared
      assert.strictEqual(world.filters.byId.size, 0);
      assert.strictEqual(world.queries.byId.size, 0);
    });

    it("resets execution tick and observation revision", () => {
      const world = createWorld();
      world.execution.tick = 100;
      world.revision = 100;

      resetWorld(world);

      assert.strictEqual(world.execution.tick, 0);
      assert.strictEqual(world.revision, 1);
    });

    it("clears event queues", () => {
      const world = createWorld();
      const TestEvent = defineEvent("ResetTestEvent", { schema: { value: Type.f32() } });

      emitEvent(world, TestEvent, { value: 42 });
      assert.ok(world.events.byId.size > 0);

      resetWorld(world);

      assert.strictEqual(world.events.byId.size, 0);
    });

    it("clears name registry", () => {
      const world = createWorld();
      const entity = createEntity(world);
      setName(world, entity, "test-entity");

      // Name exists before reset
      assert.strictEqual(lookupByName(world, "test-entity"), entity);

      resetWorld(world);

      // Name cleared
      assert.strictEqual(lookupByName(world, "test-entity"), undefined);
    });

    it("fires worldReset observer", () => {
      const world = createWorld();
      let called = false;

      registerObserverCallback(world, "worldReset", () => {
        called = true;
      });

      resetWorld(world);

      assert.strictEqual(called, true);
    });

    it("restores name lookup before firing worldReset", () => {
      const world = createWorld();

      registerObserverCallback(world, "worldReset", () => {
        const entity = createEntity(world);
        setName(world, entity, "reset-entity");
      });

      resetWorld(world);

      assert.notStrictEqual(lookupByName(world, "reset-entity"), undefined);
    });

    it("rejects reset while a frame is executing", async () => {
      const world = createWorld();
      const entity = createEntity(world);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      addSystem(
        world,
        defineSystem("waitingSystem", async function waitingSystem() {
          await gate;
        })
      );

      const frame = runOnce(world);

      assert.throws(() => resetWorld(world), IrisInvalidState);
      assert.strictEqual(isEntityAlive(world, entity), true);

      release();
      await frame;
    });

    it("can create entities after reset", () => {
      const world = createWorld();
      const Tag = defineComponent("ResetTest3");

      createEntity(world);
      resetWorld(world);

      const entity = createEntity(world);
      addComponent(world, entity, Tag);

      assert.ok(hasComponent(world, entity, Tag));
    });

    it("supports multiple resets", () => {
      const world = createWorld();
      const Tag = defineComponent("ResetTest4");

      for (let i = 0; i < 10; i++) {
        // Create entities
        for (let j = 0; j < 100; j++) {
          const entity = createEntity(world);
          addComponent(world, entity, Tag);
        }

        // Reset
        resetWorld(world);

        assert.strictEqual(world.entities.byId.size, 0);
        assert.strictEqual(world.entities.byRawId.length, 0);
      }
    });

    it("preserves observer callbacks across resets", () => {
      const world = createWorld();
      let resetCount = 0;

      registerObserverCallback(world, "worldReset", () => {
        resetCount++;
      });

      resetWorld(world);
      resetWorld(world);
      resetWorld(world);

      assert.strictEqual(resetCount, 3);
    });

    it("does not accumulate observer callbacks on repeated resets", () => {
      const world = createWorld();

      // Count callbacks before any reset
      const initialComponentRemoved = world.observers.componentRemoved.callbacks.length;
      const initialComponentChanged = world.observers.componentChanged.callbacks.length;
      const initialEntityDestroyed = world.observers.entityDestroyed.callbacks.length;

      // Perform multiple resets
      resetWorld(world);
      resetWorld(world);
      resetWorld(world);

      // Callbacks should not have accumulated
      assert.strictEqual(
        world.observers.componentRemoved.callbacks.length,
        initialComponentRemoved,
        "componentRemoved callbacks should not accumulate"
      );
      assert.strictEqual(
        world.observers.componentChanged.callbacks.length,
        initialComponentChanged,
        "componentChanged callbacks should not accumulate"
      );
      assert.strictEqual(
        world.observers.entityDestroyed.callbacks.length,
        initialEntityDestroyed,
        "entityDestroyed callbacks should not accumulate"
      );
    });

    it("preserves custom pipeline insertions", () => {
      const world = createWorld();
      const Physics = defineSchedule("Physics");

      insertScheduleBefore(world, Physics, Update);

      // Verify custom pipeline
      assert.deepStrictEqual(world.schedules.pipeline, [First, PreUpdate, Physics, Update, PostUpdate, Last]);

      resetWorld(world);

      // Pipeline should be preserved (it's configuration, not state)
      assert.deepStrictEqual(world.schedules.pipeline, [First, PreUpdate, Physics, Update, PostUpdate, Last]);
    });
  });
});
