import assert from "node:assert";
import { describe, it } from "node:test";
import { addComponent, removeComponent } from "./component.js";
import { createEntity, destroyEntity } from "./entity.js";
import { fetchEvents } from "./event.js";
import { defineComponent, defineRelation, defineTag } from "./registry.js";
import { pair } from "./relation.js";
import { removed } from "./removal.js";
import { addSystem, runOnce } from "./scheduler.js";
import { Type } from "./schema.js";
import { createWorld } from "./world.js";

describe("Removal", () => {
  // ============================================================================
  // Basic Removal Detection Tests
  // ============================================================================

  describe("Basic Removal Detection", () => {
    it("detects component removal via fetchEvents", async () => {
      const world = createWorld();
      const Health = defineComponent("RD_Health", { value: Type.f32() });
      const results: number[] = [];

      addSystem(world, function reader() {
        for (const { entity } of fetchEvents(world, removed(Health))) {
          results.push(entity);
        }
      });

      const entity = createEntity(world);
      addComponent(world, entity, Health, { value: 100 });
      removeComponent(world, entity, Health);

      await runOnce(world);

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0], entity);
    });

    it("detects removal of tag component", async () => {
      const world = createWorld();
      const Player = defineTag("RD_Player");
      const results: number[] = [];

      addSystem(world, function reader() {
        for (const { entity } of fetchEvents(world, removed(Player))) {
          results.push(entity);
        }
      });

      const entity = createEntity(world);
      addComponent(world, entity, Player);
      removeComponent(world, entity, Player);

      await runOnce(world);

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0], entity);
    });

    it("detects multiple removals of same component type", async () => {
      const world = createWorld();
      const Health = defineComponent("RD_MultiHealth", { value: Type.f32() });
      const results: number[] = [];

      addSystem(world, function reader() {
        for (const { entity } of fetchEvents(world, removed(Health))) {
          results.push(entity);
        }
      });

      const e1 = createEntity(world);
      const e2 = createEntity(world);
      const e3 = createEntity(world);

      addComponent(world, e1, Health, { value: 100 });
      addComponent(world, e2, Health, { value: 100 });
      addComponent(world, e3, Health, { value: 100 });

      removeComponent(world, e1, Health);
      removeComponent(world, e2, Health);
      removeComponent(world, e3, Health);

      await runOnce(world);

      assert.strictEqual(results.length, 3);
      assert.ok(results.includes(e1 as number));
      assert.ok(results.includes(e2 as number));
      assert.ok(results.includes(e3 as number));
    });

    it("does not emit removal for component never added", async () => {
      const world = createWorld();
      const Health = defineComponent("RD_NeverAdded", { value: Type.f32() });
      let count = 0;

      addSystem(world, function reader() {
        for (const _ of fetchEvents(world, removed(Health))) {
          count++;
        }
      });

      createEntity(world);

      await runOnce(world);

      assert.strictEqual(count, 0);
    });
  });

  // ============================================================================
  // Per-System Isolation Tests
  // ============================================================================

  describe("Per-System Isolation", () => {
    it("multiple systems see same removal independently", async () => {
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

      const entity = createEntity(world);
      addComponent(world, entity, Health, { value: 100 });
      removeComponent(world, entity, Health);

      await runOnce(world);

      assert.strictEqual(sysAResults.length, 1);
      assert.strictEqual(sysBResults.length, 1);
      assert.strictEqual(sysAResults[0], entity);
      assert.strictEqual(sysBResults[0], entity);
    });

    it("system sees removal only once after consuming", async () => {
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

      const entity = createEntity(world);
      addComponent(world, entity, Health, { value: 100 });
      removeComponent(world, entity, Health);

      await runOnce(world); // sees removal
      await runOnce(world); // already consumed

      assert.strictEqual(results[0]?.length, 1);
      assert.strictEqual(results[1]?.length, 0);
    });
  });

  // ============================================================================
  // Multiple Component Types Tests
  // ============================================================================

  describe("Multiple Component Types", () => {
    it("tracks component types independently", async () => {
      const world = createWorld();
      const Health = defineComponent("RD_Health2", { value: Type.f32() });
      const Position = defineComponent("RD_Position", { x: Type.f32(), y: Type.f32() });

      const healthRemovals: number[] = [];
      const positionRemovals: number[] = [];

      addSystem(world, function reader() {
        for (const { entity } of fetchEvents(world, removed(Health))) {
          healthRemovals.push(entity);
        }
        for (const { entity } of fetchEvents(world, removed(Position))) {
          positionRemovals.push(entity);
        }
      });

      const e1 = createEntity(world);
      const e2 = createEntity(world);

      addComponent(world, e1, Health, { value: 100 });
      addComponent(world, e2, Position, { x: 0, y: 0 });

      removeComponent(world, e1, Health);
      removeComponent(world, e2, Position);

      await runOnce(world);

      assert.strictEqual(healthRemovals.length, 1);
      assert.strictEqual(healthRemovals[0], e1);
      assert.strictEqual(positionRemovals.length, 1);
      assert.strictEqual(positionRemovals[0], e2);
    });

    it("fetching one type does not affect another", async () => {
      const world = createWorld();
      const Health = defineComponent("RD_Health3", { value: Type.f32() });
      const Armor = defineComponent("RD_Armor", { value: Type.f32() });

      let healthCount1 = 0;
      let armorCount = 0;
      let healthCount2 = 0;

      addSystem(world, function reader() {
        // Consume Health removals
        for (const _ of fetchEvents(world, removed(Health))) {
          healthCount1++;
        }
        // Armor removals should still be available
        for (const _ of fetchEvents(world, removed(Armor))) {
          armorCount++;
        }
        // Health should now be consumed
        for (const _ of fetchEvents(world, removed(Health))) {
          healthCount2++;
        }
      });

      const entity = createEntity(world);
      addComponent(world, entity, Health, { value: 100 });
      addComponent(world, entity, Armor, { value: 50 });

      removeComponent(world, entity, Health);
      removeComponent(world, entity, Armor);

      await runOnce(world);

      assert.strictEqual(healthCount1, 1);
      assert.strictEqual(armorCount, 1);
      assert.strictEqual(healthCount2, 0);
    });
  });

  // ============================================================================
  // Entity Destruction Tests
  // ============================================================================

  describe("Entity Destruction", () => {
    it("emits removals for all components on entity destruction", async () => {
      const world = createWorld();
      const Health = defineComponent("RD_DestroyHealth", { value: Type.f32() });
      const Position = defineComponent("RD_DestroyPos", { x: Type.f32(), y: Type.f32() });
      const Player = defineTag("RD_DestroyPlayer");

      let healthCount = 0;
      let positionCount = 0;
      let playerCount = 0;

      addSystem(world, function reader() {
        for (const _ of fetchEvents(world, removed(Health))) healthCount++;
        for (const _ of fetchEvents(world, removed(Position))) positionCount++;
        for (const _ of fetchEvents(world, removed(Player))) playerCount++;
      });

      const entity = createEntity(world);
      addComponent(world, entity, Health, { value: 100 });
      addComponent(world, entity, Position, { x: 10, y: 20 });
      addComponent(world, entity, Player);

      destroyEntity(world, entity);

      await runOnce(world);

      assert.strictEqual(healthCount, 1);
      assert.strictEqual(positionCount, 1);
      assert.strictEqual(playerCount, 1);
    });

    it("does not double-emit for explicit removal before destruction", async () => {
      const world = createWorld();
      const Health = defineComponent("RD_NoDouble", { value: Type.f32() });
      let count = 0;

      addSystem(world, function reader() {
        for (const _ of fetchEvents(world, removed(Health))) count++;
      });

      const entity = createEntity(world);
      addComponent(world, entity, Health, { value: 100 });

      // Explicitly remove, then destroy
      removeComponent(world, entity, Health);
      destroyEntity(world, entity);

      await runOnce(world);

      // Should only see one removal (explicit)
      assert.strictEqual(count, 1);
    });

    it("destruction of entity with no components emits no removals", async () => {
      const world = createWorld();
      const Health = defineComponent("RD_NoCompHealth", { value: Type.f32() });
      let count = 0;

      addSystem(world, function reader() {
        for (const _ of fetchEvents(world, removed(Health))) count++;
      });

      const entity = createEntity(world);
      destroyEntity(world, entity);

      await runOnce(world);

      assert.strictEqual(count, 0);
    });
  });

  // ============================================================================
  // Relation Pair Removal Tests
  // ============================================================================

  describe("Relation Pair Removals", () => {
    it("detects relation pair removal via removeComponent", async () => {
      const world = createWorld();
      const ChildOf = defineRelation("RD_ChildOf");
      const results: number[] = [];

      addSystem(world, function reader() {
        for (const { entity } of fetchEvents(world, removed(pair(ChildOf, parent)))) {
          results.push(entity);
        }
      });

      const parent = createEntity(world);
      const child = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent));
      removeComponent(world, child, pair(ChildOf, parent));

      await runOnce(world);

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0], child);
    });

    it("detects relation pair removal on entity destruction", async () => {
      const world = createWorld();
      const ChildOf = defineRelation("RD_ChildOf2");
      const results: number[] = [];

      const parent = createEntity(world);

      addSystem(world, function reader() {
        for (const { entity } of fetchEvents(world, removed(pair(ChildOf, parent)))) {
          results.push(entity);
        }
      });

      const child = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent));
      destroyEntity(world, child);

      await runOnce(world);

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0], child);
    });

    it("tracks different pair targets independently", async () => {
      const world = createWorld();
      const ChildOf = defineRelation("RD_ChildOf3");

      const parent1 = createEntity(world);
      const parent2 = createEntity(world);

      const parent1Removals: number[] = [];
      const parent2Removals: number[] = [];

      addSystem(world, function reader() {
        for (const { entity } of fetchEvents(world, removed(pair(ChildOf, parent1)))) {
          parent1Removals.push(entity);
        }
        for (const { entity } of fetchEvents(world, removed(pair(ChildOf, parent2)))) {
          parent2Removals.push(entity);
        }
      });

      const child1 = createEntity(world);
      const child2 = createEntity(world);

      addComponent(world, child1, pair(ChildOf, parent1));
      addComponent(world, child2, pair(ChildOf, parent2));

      removeComponent(world, child1, pair(ChildOf, parent1));
      removeComponent(world, child2, pair(ChildOf, parent2));

      await runOnce(world);

      assert.strictEqual(parent1Removals.length, 1);
      assert.strictEqual(parent1Removals[0], child1);
      assert.strictEqual(parent2Removals.length, 1);
      assert.strictEqual(parent2Removals[0], child2);
    });

    it("tracks relation with data schema", async () => {
      const world = createWorld();
      const Owns = defineRelation("RD_Owns", { schema: { quantity: Type.i32() } });
      const results: number[] = [];

      const player = createEntity(world);
      const item = createEntity(world);

      addSystem(world, function reader() {
        for (const { entity } of fetchEvents(world, removed(pair(Owns, item)))) {
          results.push(entity);
        }
      });

      addComponent(world, player, pair(Owns, item), { quantity: 5 });
      removeComponent(world, player, pair(Owns, item));

      await runOnce(world);

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0], player);
    });
  });

  // ============================================================================
  // Lazy Event Creation Tests
  // ============================================================================

  describe("Lazy Event Creation", () => {
    it("creates different events for different components", () => {
      const Health = defineComponent("RD_Lazy2Health", { value: Type.f32() });
      const Mana = defineComponent("RD_Lazy2Mana", { value: Type.f32() });

      const healthEvent = removed(Health);
      const manaEvent = removed(Mana);

      assert.notStrictEqual(healthEvent, manaEvent);
      assert.notStrictEqual(healthEvent.id, manaEvent.id);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("Edge Cases", () => {
    it("same entity can have component removed multiple times (add-remove-add-remove)", async () => {
      const world = createWorld();
      const Health = defineComponent("RD_MultiRemove", { value: Type.f32() });

      const results: number[][] = [];

      addSystem(world, function reader() {
        const batch: number[] = [];
        for (const { entity } of fetchEvents(world, removed(Health))) {
          batch.push(entity);
        }
        results.push(batch);
      });

      const entity = createEntity(world);

      addComponent(world, entity, Health, { value: 100 });
      removeComponent(world, entity, Health);

      await runOnce(world); // First frame: sees first removal

      addComponent(world, entity, Health, { value: 50 });
      removeComponent(world, entity, Health);

      await runOnce(world); // Second frame: sees second removal

      assert.strictEqual(results[0]!.length, 1);
      assert.strictEqual(results[1]!.length, 1);
      assert.strictEqual(results[1]![0], entity);
    });
  });
});
