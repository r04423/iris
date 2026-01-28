import assert from "node:assert";
import { describe, it } from "node:test";

import { addComponent, hasComponent } from "./component.js";
import { createEntity } from "./entity.js";
import { defineEvent, emitEvent } from "./event.js";
import { lookupByName, setName } from "./name.js";
import { registerObserverCallback } from "./observer.js";
import { fetchEntities } from "./query.js";
import { defineTag } from "./registry.js";
import { addSystem, buildSchedule } from "./scheduler.js";
import { Type } from "./schema.js";
import { createWorld, resetWorld } from "./world.js";

describe("World", () => {
  describe("World Creation", () => {
    it("creates world with entity registry", () => {
      const world = createWorld();

      assert.ok(world.entities);
      assert.ok(world.entities.byId);
    });

    it("creates world with entity registry containing NameRegistry resource", () => {
      const world = createWorld();

      const entityRegistry = world.entities;
      // NameRegistry resource is automatically added during world creation
      assert.strictEqual(entityRegistry.byId.size, 1);
      assert.strictEqual(entityRegistry.freeIds.length, 0);
      assert.strictEqual(entityRegistry.nextId, 1);
    });

    it("creates world with archetype index", () => {
      const world = createWorld();

      assert.ok(world.archetypes);
      assert.ok(world.archetypes.root);
      assert.ok(world.archetypes.byId);
    });

    it("creates root archetype with empty types", () => {
      const world = createWorld();

      const root = world.archetypes.root;
      assert.deepStrictEqual(root.types, []);
      assert.strictEqual(root.hash, "");
      assert.strictEqual(root.typesSet.size, 0);
      // Root has edge to NameRegistry archetype from automatic resource init
      assert.strictEqual(root.edges.size, 1);
    });

    it("registers root archetype in archetype map", () => {
      const world = createWorld();

      const root = world.archetypes.root;
      const registeredRoot = world.archetypes.byId.get(root.hash);

      assert.strictEqual(registeredRoot, root);
    });

    it("initializes filter registry", () => {
      const world = createWorld();

      assert.ok(world.filters);
      assert.ok(world.filters.byId);
      assert.strictEqual(world.filters.byId.size, 0);
    });

    it("initializes observer system with lifecycle callbacks", () => {
      const world = createWorld();

      assert.ok(world.observers);
      assert.ok(world.observers.archetypeCreated);
      assert.ok(world.observers.archetypeDestroyed);
      assert.ok(world.observers.entityCreated);
      assert.ok(world.observers.entityDestroyed);
      assert.ok(world.observers.componentAdded);
      assert.ok(world.observers.componentRemoved);
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
      const Tag = defineTag("ResetTest1");

      const entity = createEntity(world);
      addComponent(world, entity, Tag);

      // Entity exists before reset
      assert.ok(hasComponent(world, entity, Tag));

      resetWorld(world);

      // All entities cleared (only NameRegistry resource remains)
      assert.strictEqual(world.entities.byId.size, 1);
    });

    it("preserves systems and schedules", () => {
      const world = createWorld();

      function testSystem() {
        // no-op
      }

      addSystem(world, testSystem);
      buildSchedule(world);

      resetWorld(world);

      // System still registered
      assert.ok(world.systems.byId.has("testSystem"));
      // Schedule still built
      assert.ok(world.schedules.byId.has("runtime"));
    });

    it("clears queries and filters", () => {
      const world = createWorld();
      const Tag = defineTag("ResetTest2");

      const entity = createEntity(world);
      addComponent(world, entity, Tag);

      // Create query (populates filter and query registries)
      const results = [...fetchEntities(world, Tag)];
      assert.strictEqual(results.length, 1);
      assert.ok(world.filters.byId.size > 0);
      assert.ok(world.queries.byId.size > 0);

      resetWorld(world);

      // Queries and filters cleared
      assert.strictEqual(world.filters.byId.size, 0);
      assert.strictEqual(world.queries.byId.size, 0);
    });

    it("resets execution tick to 1", () => {
      const world = createWorld();
      world.execution.tick = 100;

      resetWorld(world);

      assert.strictEqual(world.execution.tick, 1);
    });

    it("clears event queues", () => {
      const world = createWorld();
      const TestEvent = defineEvent("ResetTestEvent", { value: Type.f32() });

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

    it("can create entities after reset", () => {
      const world = createWorld();
      const Tag = defineTag("ResetTest3");

      createEntity(world);
      resetWorld(world);

      const entity = createEntity(world);
      addComponent(world, entity, Tag);

      assert.ok(hasComponent(world, entity, Tag));
    });

    it("supports multiple resets", () => {
      const world = createWorld();
      const Tag = defineTag("ResetTest4");

      for (let i = 0; i < 10; i++) {
        // Create entities
        for (let j = 0; j < 100; j++) {
          const entity = createEntity(world);
          addComponent(world, entity, Tag);
        }

        // Reset
        resetWorld(world);

        // Verify clean state (only NameRegistry resource)
        assert.strictEqual(world.entities.byId.size, 1);
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
  });
});
