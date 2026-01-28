import assert from "node:assert";
import { describe, it } from "node:test";
import { addComponent, removeComponent } from "./component.js";
import { createEntity, destroyEntity } from "./entity.js";
import { fetchEvents } from "./event.js";
import { defineComponent, defineRelation, defineTag } from "./registry.js";
import { pair } from "./relation.js";
import { removed } from "./removal.js";
import { addSystem, buildSchedule, executeSchedule } from "./scheduler.js";
import { Type } from "./schema.js";
import { createWorld } from "./world.js";

describe("Removal", () => {
  // ============================================================================
  // Basic Removal Detection Tests
  // ============================================================================

  describe("Basic Removal Detection", () => {
    it("detects component removal via fetchEvents", () => {
      const world = createWorld();
      const Health = defineComponent("RD_Health", { value: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Health, { value: 100 });

      removeComponent(world, entity, Health);

      const results = [...fetchEvents(world, removed(Health))];

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0]?.entity, entity);
    });

    it("detects removal of tag component", () => {
      const world = createWorld();
      const Player = defineTag("RD_Player");

      const entity = createEntity(world);
      addComponent(world, entity, Player);

      removeComponent(world, entity, Player);

      const results = [...fetchEvents(world, removed(Player))];

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0]?.entity, entity);
    });

    it("detects multiple removals of same component type", () => {
      const world = createWorld();
      const Health = defineComponent("RD_MultiHealth", { value: Type.f32() });

      const e1 = createEntity(world);
      const e2 = createEntity(world);
      const e3 = createEntity(world);

      addComponent(world, e1, Health, { value: 100 });
      addComponent(world, e2, Health, { value: 100 });
      addComponent(world, e3, Health, { value: 100 });

      removeComponent(world, e1, Health);
      removeComponent(world, e2, Health);
      removeComponent(world, e3, Health);

      const results = [...fetchEvents(world, removed(Health))];
      const entities = results.map((r) => r.entity);

      assert.strictEqual(results.length, 3);
      assert.ok(entities.includes(e1));
      assert.ok(entities.includes(e2));
      assert.ok(entities.includes(e3));
    });

    it("does not emit removal for component never added", () => {
      const world = createWorld();
      const Health = defineComponent("RD_NeverAdded", { value: Type.f32() });

      createEntity(world);

      const results = [...fetchEvents(world, removed(Health))];

      assert.strictEqual(results.length, 0);
    });
  });

  // ============================================================================
  // Per-System Isolation Tests
  // ============================================================================

  describe("Per-System Isolation", () => {
    it("multiple systems see same removal independently", () => {
      const world = createWorld();
      const Health = defineComponent("RD_IsoHealth", { value: Type.f32() });

      const sysAResults: number[] = [];
      const sysBResults: number[] = [];

      addSystem(world, function sysA() {
        for (const { entity } of fetchEvents(world, removed(Health))) {
          sysAResults.push(entity);
        }
      });

      addSystem(world, function sysB() {
        for (const { entity } of fetchEvents(world, removed(Health))) {
          sysBResults.push(entity);
        }
      });

      buildSchedule(world);

      const entity = createEntity(world);
      addComponent(world, entity, Health, { value: 100 });
      removeComponent(world, entity, Health);

      executeSchedule(world);

      assert.strictEqual(sysAResults.length, 1);
      assert.strictEqual(sysBResults.length, 1);
      assert.strictEqual(sysAResults[0], entity);
      assert.strictEqual(sysBResults[0], entity);
    });

    it("system sees removal only once after consuming", () => {
      const world = createWorld();
      const Health = defineComponent("RD_OnceHealth", { value: Type.f32() });

      const results: number[][] = [];

      addSystem(world, function consumer() {
        const tickResults: number[] = [];
        for (const { entity } of fetchEvents(world, removed(Health))) {
          tickResults.push(entity);
        }
        results.push(tickResults);
      });

      buildSchedule(world);

      const entity = createEntity(world);
      addComponent(world, entity, Health, { value: 100 });
      removeComponent(world, entity, Health);

      executeSchedule(world); // tick 2: sees removal
      executeSchedule(world); // tick 3: already consumed

      assert.strictEqual(results[0]?.length, 1);
      assert.strictEqual(results[1]?.length, 0);
    });
  });

  // ============================================================================
  // Multiple Component Types Tests
  // ============================================================================

  describe("Multiple Component Types", () => {
    it("tracks component types independently", () => {
      const world = createWorld();
      const Health = defineComponent("RD_Health2", { value: Type.f32() });
      const Position = defineComponent("RD_Position", { x: Type.f32(), y: Type.f32() });

      const e1 = createEntity(world);
      const e2 = createEntity(world);

      addComponent(world, e1, Health, { value: 100 });
      addComponent(world, e2, Position, { x: 0, y: 0 });

      removeComponent(world, e1, Health);
      removeComponent(world, e2, Position);

      const healthRemovals = [...fetchEvents(world, removed(Health))];
      const positionRemovals = [...fetchEvents(world, removed(Position))];

      assert.strictEqual(healthRemovals.length, 1);
      assert.strictEqual(healthRemovals[0]?.entity, e1);
      assert.strictEqual(positionRemovals.length, 1);
      assert.strictEqual(positionRemovals[0]?.entity, e2);
    });

    it("fetching one type does not affect another", () => {
      const world = createWorld();
      const Health = defineComponent("RD_Health3", { value: Type.f32() });
      const Armor = defineComponent("RD_Armor", { value: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Health, { value: 100 });
      addComponent(world, entity, Armor, { value: 50 });

      removeComponent(world, entity, Health);
      removeComponent(world, entity, Armor);

      // Consume Health removals
      const healthRemovals = [...fetchEvents(world, removed(Health))];
      assert.strictEqual(healthRemovals.length, 1);

      // Armor removals should still be available
      const armorRemovals = [...fetchEvents(world, removed(Armor))];
      assert.strictEqual(armorRemovals.length, 1);

      // Health should now be consumed
      const healthRemovals2 = [...fetchEvents(world, removed(Health))];
      assert.strictEqual(healthRemovals2.length, 0);
    });
  });

  // ============================================================================
  // Entity Destruction Tests
  // ============================================================================

  describe("Entity Destruction", () => {
    it("emits removals for all components on entity destruction", () => {
      const world = createWorld();
      const Health = defineComponent("RD_DestroyHealth", { value: Type.f32() });
      const Position = defineComponent("RD_DestroyPos", { x: Type.f32(), y: Type.f32() });
      const Player = defineTag("RD_DestroyPlayer");

      const entity = createEntity(world);
      addComponent(world, entity, Health, { value: 100 });
      addComponent(world, entity, Position, { x: 10, y: 20 });
      addComponent(world, entity, Player);

      destroyEntity(world, entity);

      const healthRemovals = [...fetchEvents(world, removed(Health))];
      const positionRemovals = [...fetchEvents(world, removed(Position))];
      const playerRemovals = [...fetchEvents(world, removed(Player))];

      assert.strictEqual(healthRemovals.length, 1);
      assert.strictEqual(healthRemovals[0]?.entity, entity);
      assert.strictEqual(positionRemovals.length, 1);
      assert.strictEqual(positionRemovals[0]?.entity, entity);
      assert.strictEqual(playerRemovals.length, 1);
      assert.strictEqual(playerRemovals[0]?.entity, entity);
    });

    it("does not double-emit for explicit removal before destruction", () => {
      const world = createWorld();
      const Health = defineComponent("RD_NoDouble", { value: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Health, { value: 100 });

      // Explicitly remove, then destroy
      removeComponent(world, entity, Health);
      destroyEntity(world, entity);

      // Should only see one removal (explicit)
      // The entityDestroyed observer won't emit for Health because entity no longer has it
      const removals = [...fetchEvents(world, removed(Health))];

      assert.strictEqual(removals.length, 1);
      assert.strictEqual(removals[0]?.entity, entity);
    });

    it("destruction of entity with no components emits no removals", () => {
      const world = createWorld();
      const Health = defineComponent("RD_NoCompHealth", { value: Type.f32() });

      const entity = createEntity(world);
      // Add nothing

      destroyEntity(world, entity);

      const removals = [...fetchEvents(world, removed(Health))];
      assert.strictEqual(removals.length, 0);
    });
  });

  // ============================================================================
  // Relation Pair Removal Tests
  // ============================================================================

  describe("Relation Pair Removals", () => {
    it("detects relation pair removal via removeComponent", () => {
      const world = createWorld();
      const ChildOf = defineRelation("RD_ChildOf");

      const parent = createEntity(world);
      const child = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent));
      removeComponent(world, child, pair(ChildOf, parent));

      const removals = [...fetchEvents(world, removed(pair(ChildOf, parent)))];

      assert.strictEqual(removals.length, 1);
      assert.strictEqual(removals[0]?.entity, child);
    });

    it("detects relation pair removal on entity destruction", () => {
      const world = createWorld();
      const ChildOf = defineRelation("RD_ChildOf2");

      const parent = createEntity(world);
      const child = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent));

      destroyEntity(world, child);

      const removals = [...fetchEvents(world, removed(pair(ChildOf, parent)))];

      assert.strictEqual(removals.length, 1);
      assert.strictEqual(removals[0]?.entity, child);
    });

    it("tracks different pair targets independently", () => {
      const world = createWorld();
      const ChildOf = defineRelation("RD_ChildOf3");

      const parent1 = createEntity(world);
      const parent2 = createEntity(world);
      const child1 = createEntity(world);
      const child2 = createEntity(world);

      addComponent(world, child1, pair(ChildOf, parent1));
      addComponent(world, child2, pair(ChildOf, parent2));

      removeComponent(world, child1, pair(ChildOf, parent1));
      removeComponent(world, child2, pair(ChildOf, parent2));

      const parent1Removals = [...fetchEvents(world, removed(pair(ChildOf, parent1)))];
      const parent2Removals = [...fetchEvents(world, removed(pair(ChildOf, parent2)))];

      assert.strictEqual(parent1Removals.length, 1);
      assert.strictEqual(parent1Removals[0]?.entity, child1);
      assert.strictEqual(parent2Removals.length, 1);
      assert.strictEqual(parent2Removals[0]?.entity, child2);
    });

    it("tracks relation with data schema", () => {
      const world = createWorld();
      const Owns = defineRelation("RD_Owns", { schema: { quantity: Type.i32() } });

      const player = createEntity(world);
      const item = createEntity(world);

      addComponent(world, player, pair(Owns, item), { quantity: 5 });
      removeComponent(world, player, pair(Owns, item));

      const removals = [...fetchEvents(world, removed(pair(Owns, item)))];

      assert.strictEqual(removals.length, 1);
      assert.strictEqual(removals[0]?.entity, player);
    });
  });

  // ============================================================================
  // Lazy Event Creation Tests
  // ============================================================================

  describe("Lazy Event Creation", () => {
    it("returns same event for repeated calls", () => {
      const Health = defineComponent("RD_LazyHealth", { value: Type.f32() });

      const event1 = removed(Health);
      const event2 = removed(Health);

      assert.strictEqual(event1, event2);
      assert.strictEqual(event1.id, event2.id);
    });

    it("creates different events for different components", () => {
      const Health = defineComponent("RD_Lazy2Health", { value: Type.f32() });
      const Mana = defineComponent("RD_Lazy2Mana", { value: Type.f32() });

      const healthEvent = removed(Health);
      const manaEvent = removed(Mana);

      assert.notStrictEqual(healthEvent, manaEvent);
      assert.notStrictEqual(healthEvent.id, manaEvent.id);
    });

    it("event queue created on first removal emission", () => {
      const world = createWorld();
      const LazyComp = defineComponent("RD_LazyComp", { value: Type.f32() });

      // Event exists but no queue yet
      const eventBefore = removed(LazyComp);
      assert.strictEqual(world.events.byId.has(eventBefore.id), false);

      // Removal creates the queue
      const entity = createEntity(world);
      addComponent(world, entity, LazyComp, { value: 100 });
      removeComponent(world, entity, LazyComp);

      assert.strictEqual(world.events.byId.has(eventBefore.id), true);
    });

    it("event name includes component ID for debugging", () => {
      const TestComp = defineComponent("RD_NamedComp", { value: Type.f32() });

      const event = removed(TestComp);

      assert.ok(event.name.startsWith("Removed<"));
      assert.ok(event.name.endsWith(">"));
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("Edge Cases", () => {
    it("same entity can have component removed multiple times (add-remove-add-remove)", () => {
      const world = createWorld();
      const Health = defineComponent("RD_MultiRemove", { value: Type.f32() });

      addSystem(world, function noop() {});
      buildSchedule(world);

      const entity = createEntity(world);

      addComponent(world, entity, Health, { value: 100 });
      removeComponent(world, entity, Health);

      const firstRemovals = [...fetchEvents(world, removed(Health))];
      assert.strictEqual(firstRemovals.length, 1);

      // Advance tick so the second removal will have a new tick
      executeSchedule(world);

      addComponent(world, entity, Health, { value: 50 });
      removeComponent(world, entity, Health);

      const secondRemovals = [...fetchEvents(world, removed(Health))];
      assert.strictEqual(secondRemovals.length, 1);
      assert.strictEqual(secondRemovals[0]?.entity, entity);
    });
  });
});
