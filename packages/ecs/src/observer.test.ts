import assert from "node:assert";
import { describe, it } from "node:test";
import type { Archetype } from "./archetype.js";
import { createAndRegisterArchetype, destroyArchetype } from "./archetype.js";
import { createEntity } from "./entity.js";
import { registerObserverCallback, unregisterObserverCallback } from "./observer.js";
import { createWorld } from "./world.js";

describe("Observer", () => {
  // ============================================================================
  // Observer Registration
  // ============================================================================

  describe("Observer Registration", () => {
    it("registers callback for archetypeCreated event", () => {
      const world = createWorld();
      const initialCount = world.observers.archetypeCreated.callbacks.length;

      const callback = () => {};

      registerObserverCallback(world, "archetypeCreated", callback);

      assert.strictEqual(world.observers.archetypeCreated.callbacks.length, initialCount + 1);
      assert.strictEqual(world.observers.archetypeCreated.callbacks[initialCount], callback);
    });

    it("registers multiple callbacks for same event", () => {
      const world = createWorld();
      const initialCount = world.observers.archetypeCreated.callbacks.length;
      const callback1 = () => {};
      const callback2 = () => {};

      registerObserverCallback(world, "archetypeCreated", callback1);
      registerObserverCallback(world, "archetypeCreated", callback2);

      assert.strictEqual(world.observers.archetypeCreated.callbacks.length, initialCount + 2);
    });

    it("unregisters callback from event", () => {
      const world = createWorld();
      const callback = () => {};

      registerObserverCallback(world, "archetypeCreated", callback);
      const countAfterRegister = world.observers.archetypeCreated.callbacks.length;

      unregisterObserverCallback(world, "archetypeCreated", callback);
      assert.strictEqual(world.observers.archetypeCreated.callbacks.length, countAfterRegister - 1);
    });

    it("handles unregistering non-existent callback gracefully", () => {
      const world = createWorld();
      const initialCount = world.observers.archetypeCreated.callbacks.length;
      const callback = () => {};

      unregisterObserverCallback(world, "archetypeCreated", callback);

      assert.strictEqual(world.observers.archetypeCreated.callbacks.length, initialCount);
    });
  });

  // ============================================================================
  // Event Dispatch
  // ============================================================================

  describe("Event Dispatch", () => {
    it("fires archetypeCreated event with archetype payload", () => {
      const world = createWorld();
      const Position = createEntity(world);
      let receivedArchetype: Archetype | null = null;

      const callback = (archetype: Archetype) => {
        receivedArchetype = archetype;
      };

      registerObserverCallback(world, "archetypeCreated", callback);

      const archetype = createAndRegisterArchetype(world, [Position], new Map());

      assert.strictEqual(receivedArchetype, archetype);
    });

    it("fires archetypeDestroyed event before cleanup", () => {
      const world = createWorld();
      const Position = createEntity(world);
      let archetypeStillExists = false;

      const archetype = createAndRegisterArchetype(world, [Position], new Map());

      const callback = (destroyedArchetype: Archetype) => {
        // At this point, archetype should still exist in registry
        archetypeStillExists = world.archetypes.byId.has(destroyedArchetype.hash);
      };

      registerObserverCallback(world, "archetypeDestroyed", callback);

      destroyArchetype(world, archetype);

      // Callback should have fired before cleanup
      assert.strictEqual(archetypeStillExists, true);
    });

    it("calls all registered callbacks for an event", () => {
      const world = createWorld();
      const Position = createEntity(world);
      let callCount1 = 0;
      let callCount2 = 0;

      registerObserverCallback(world, "archetypeCreated", () => {
        callCount1++;
      });
      registerObserverCallback(world, "archetypeCreated", () => {
        callCount2++;
      });

      createAndRegisterArchetype(world, [Position], new Map());

      assert.strictEqual(callCount1, 1);
      assert.strictEqual(callCount2, 1);
    });
  });

  // ============================================================================
  // Observer Safety
  // ============================================================================

  describe("Observer Safety", () => {
    it("handles callback unregistering itself during execution", () => {
      const world = createWorld();
      const callOrder: string[] = [];

      const callback1 = () => {
        callOrder.push("callback1");
        // Unregister itself
        unregisterObserverCallback(world, "entityCreated", callback1);
      };

      const callback2 = () => {
        callOrder.push("callback2");
      };

      registerObserverCallback(world, "entityCreated", callback1);
      registerObserverCallback(world, "entityCreated", callback2);

      // Trigger event (createEntity fires "entityCreated" internally)
      createEntity(world);

      // Both should have been called
      // Note: Since we iterate backwards, callback2 is called first, then callback1.
      assert.deepStrictEqual(callOrder.sort(), ["callback1", "callback2"]);

      // callback1 should be removed
      assert.strictEqual(world.observers.entityCreated.callbacks.includes(callback1), false);
      assert.strictEqual(world.observers.entityCreated.callbacks.includes(callback2), true);
    });
  });
});
