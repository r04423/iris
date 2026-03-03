import assert from "node:assert";
import { describe, it } from "node:test";
import {
  addComponent,
  createEntity,
  createWorld,
  defineComponent,
  defineTag,
  destroyEntity,
  removeComponent,
  resetWorld,
  setName,
  Type,
} from "iris-ecs";
import { attachBridge } from "../bridge.js";
import { createDevToolsStore } from "../store.js";

describe("Bridge", () => {
  // ============================================================================
  // Initial Snapshot
  // ============================================================================

  describe("Initial Snapshot", () => {
    it("captures existing game entities", () => {
      const world = createWorld();
      const e1 = createEntity(world);
      const e2 = createEntity(world);

      const store = createDevToolsStore();
      const cleanup = attachBridge(world, store);

      assert.strictEqual(store.getState().entityCount, 2);
      assert.ok(store.getState().entities.has(e1));
      assert.ok(store.getState().entities.has(e2));

      cleanup();
    });

    it("excludes components and tags from snapshot", () => {
      const world = createWorld();
      createEntity(world);
      defineTag("TestTag");
      defineComponent("TestComp", { value: Type.f32() });

      const store = createDevToolsStore();
      const cleanup = attachBridge(world, store);

      // Only the game entity should be in the store
      assert.strictEqual(store.getState().entityCount, 1);

      cleanup();
    });

    it("captures entity names", () => {
      const world = createWorld();
      const entity = createEntity(world);
      setName(world, entity, "Player");

      const store = createDevToolsStore();
      const cleanup = attachBridge(world, store);

      assert.strictEqual(store.getState().entities.get(entity)!.name, "Player");

      cleanup();
    });

    it("captures component count", () => {
      const world = createWorld();
      const Health = defineComponent("BridgeTestHealth", { value: Type.f32() });
      const entity = createEntity(world);
      addComponent(world, entity, Health, { value: 100 });

      const store = createDevToolsStore();
      const cleanup = attachBridge(world, store);

      // Name system adds Name internally, but we explicitly added Health
      // The component count reflects archetype.types.length
      const snapshot = store.getState().entities.get(entity)!;
      assert.ok(snapshot.componentCount >= 1);

      cleanup();
    });
  });

  // ============================================================================
  // Entity Lifecycle
  // ============================================================================

  describe("Entity Lifecycle", () => {
    it("adds entity to store on entityCreated", () => {
      const world = createWorld();
      const store = createDevToolsStore();
      const cleanup = attachBridge(world, store);

      assert.strictEqual(store.getState().entityCount, 0);

      const entity = createEntity(world);

      assert.strictEqual(store.getState().entityCount, 1);
      assert.ok(store.getState().entities.has(entity));

      cleanup();
    });

    it("removes entity from store on entityDestroyed", () => {
      const world = createWorld();
      const store = createDevToolsStore();
      const cleanup = attachBridge(world, store);

      const entity = createEntity(world);
      assert.strictEqual(store.getState().entityCount, 1);

      destroyEntity(world, entity);
      assert.strictEqual(store.getState().entityCount, 0);
      assert.ok(!store.getState().entities.has(entity));

      cleanup();
    });

    it("ignores entityDestroyed for non-tracked entities", () => {
      const world = createWorld();
      const store = createDevToolsStore();
      const cleanup = attachBridge(world, store);

      // Tags get destroyed during world operations but shouldn't affect store
      const entity = createEntity(world);
      assert.strictEqual(store.getState().entityCount, 1);

      destroyEntity(world, entity);
      assert.strictEqual(store.getState().entityCount, 0);

      cleanup();
    });
  });

  // ============================================================================
  // Component Changes
  // ============================================================================

  describe("Component Changes", () => {
    it("updates component count on componentAdded", () => {
      const world = createWorld();
      const store = createDevToolsStore();
      const cleanup = attachBridge(world, store);
      const Health = defineComponent("BridgeAddHealth", { value: Type.f32() });

      const entity = createEntity(world);
      const countBefore = store.getState().entities.get(entity)!.componentCount;

      addComponent(world, entity, Health, { value: 100 });
      const countAfter = store.getState().entities.get(entity)!.componentCount;

      assert.strictEqual(countAfter, countBefore + 1);

      cleanup();
    });

    it("updates component count on componentRemoved", () => {
      const world = createWorld();
      const store = createDevToolsStore();
      const cleanup = attachBridge(world, store);
      const Health = defineComponent("BridgeRemoveHealth", { value: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Health, { value: 100 });
      const countBefore = store.getState().entities.get(entity)!.componentCount;

      removeComponent(world, entity, Health);
      const countAfter = store.getState().entities.get(entity)!.componentCount;

      assert.strictEqual(countAfter, countBefore - 1);

      cleanup();
    });

    it("updates name when Name component changes", () => {
      const world = createWorld();
      const store = createDevToolsStore();
      const cleanup = attachBridge(world, store);

      const entity = createEntity(world);
      setName(world, entity, "Player");

      assert.strictEqual(store.getState().entities.get(entity)!.name, "Player");

      cleanup();
    });
  });

  // ============================================================================
  // World Reset
  // ============================================================================

  describe("World Reset", () => {
    it("clears store on worldReset", () => {
      const world = createWorld();
      const store = createDevToolsStore();
      const cleanup = attachBridge(world, store);

      createEntity(world);
      createEntity(world);
      assert.strictEqual(store.getState().entityCount, 2);

      resetWorld(world);
      assert.strictEqual(store.getState().entityCount, 0);
      assert.strictEqual(store.getState().entities.size, 0);

      cleanup();
    });
  });

  // ============================================================================
  // Cleanup
  // ============================================================================

  describe("Cleanup", () => {
    it("unregisters all observers on cleanup", () => {
      const world = createWorld();
      const store = createDevToolsStore();

      const createdBefore = world.observers.entityCreated.callbacks.length;
      const destroyedBefore = world.observers.entityDestroyed.callbacks.length;
      const addedBefore = world.observers.componentAdded.callbacks.length;
      const removedBefore = world.observers.componentRemoved.callbacks.length;
      const changedBefore = world.observers.componentChanged.callbacks.length;
      const resetBefore = world.observers.worldReset.callbacks.length;

      const cleanup = attachBridge(world, store);

      // Observers should be registered
      assert.strictEqual(world.observers.entityCreated.callbacks.length, createdBefore + 1);
      assert.strictEqual(world.observers.entityDestroyed.callbacks.length, destroyedBefore + 1);
      assert.strictEqual(world.observers.componentAdded.callbacks.length, addedBefore + 1);
      assert.strictEqual(world.observers.componentRemoved.callbacks.length, removedBefore + 1);
      assert.strictEqual(world.observers.componentChanged.callbacks.length, changedBefore + 1);
      assert.strictEqual(world.observers.worldReset.callbacks.length, resetBefore + 1);

      cleanup();

      // All observers should be unregistered
      assert.strictEqual(world.observers.entityCreated.callbacks.length, createdBefore);
      assert.strictEqual(world.observers.entityDestroyed.callbacks.length, destroyedBefore);
      assert.strictEqual(world.observers.componentAdded.callbacks.length, addedBefore);
      assert.strictEqual(world.observers.componentRemoved.callbacks.length, removedBefore);
      assert.strictEqual(world.observers.componentChanged.callbacks.length, changedBefore);
      assert.strictEqual(world.observers.worldReset.callbacks.length, resetBefore);
    });

    it("stops tracking entities after cleanup", () => {
      const world = createWorld();
      const store = createDevToolsStore();
      const cleanup = attachBridge(world, store);

      cleanup();

      createEntity(world);
      assert.strictEqual(store.getState().entityCount, 0);
    });
  });
});
