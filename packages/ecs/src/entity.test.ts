import assert from "node:assert";
import { describe, it } from "node:test";
import { addComponent } from "./component.js";
import type { EntityId } from "./encoding.js";
import { extractId, extractMeta, ID_MASK_20 } from "./encoding.js";
import { createEntity, destroyEntity, ensureEntity, isEntityAlive } from "./entity.js";
import { LimitExceeded, NotFound } from "./error.js";
import { defineComponent, defineRelation, defineTag, Wildcard } from "./registry.js";
import { pair } from "./relation.js";
import { Type } from "./schema.js";
import { createWorld } from "./world.js";

describe("Entity", () => {
  describe("Entity Creation", () => {
    it("creates entities with unique IDs", () => {
      const world = createWorld();

      const e1 = createEntity(world);
      const e2 = createEntity(world);
      const e3 = createEntity(world);

      assert.notStrictEqual(e1, e2);
      assert.notStrictEqual(e2, e3);
      assert.notStrictEqual(e1, e3);
    });

    it("creates entities with generation 0", () => {
      const world = createWorld();

      const entity = createEntity(world);
      const generation = extractMeta(entity);

      assert.strictEqual(generation, 0);
    });

    it("updates entity registry counters", () => {
      const world = createWorld();
      const registry = world.entities;
      // World starts with 1 entity (NameRegistry resource)
      const initialSize = registry.byId.size;

      createEntity(world);
      createEntity(world);

      assert.strictEqual(registry.byId.size, initialSize + 2);
      assert.strictEqual(registry.nextId, 3);
    });
  });

  describe("Entity Aliveness", () => {
    it("returns true for alive entities", () => {
      const world = createWorld();
      const entity = createEntity(world);

      assert.strictEqual(isEntityAlive(world, entity), true);
    });

    it("returns false for destroyed entities", () => {
      const world = createWorld();
      const entity = createEntity(world);

      destroyEntity(world, entity);

      assert.strictEqual(isEntityAlive(world, entity), false);
    });

    it("returns false for never-created entities", () => {
      const world = createWorld();

      assert.strictEqual(isEntityAlive(world, 999999 as EntityId), false);
    });
  });

  describe("Entity Destruction", () => {
    it("removes entity from metadata", () => {
      const world = createWorld();
      const registry = world.entities;

      const entity = createEntity(world);
      const sizeBefore = registry.byId.size;

      destroyEntity(world, entity);

      assert.strictEqual(registry.byId.size, sizeBefore - 1);
      assert.strictEqual(isEntityAlive(world, entity), false);
    });

    it("adds entity to freelist with incremented generation", () => {
      const world = createWorld();
      const registry = world.entities;

      const entity = createEntity(world);
      const rawId = extractId(entity);
      const oldGeneration = extractMeta(entity);

      destroyEntity(world, entity);

      // Check raw ID in freelist and generation incremented in map
      assert.strictEqual(registry.freeIds.length, 1);
      assert.strictEqual(registry.freeIds[0], rawId);
      const newGeneration = registry.generations.get(rawId);

      assert.strictEqual(newGeneration, oldGeneration + 1);
    });

    it("double destroy is idempotent", () => {
      const world = createWorld();
      const entity = createEntity(world);

      destroyEntity(world, entity);

      // Second destroy should be idempotent (no-op for cascade safety)
      destroyEntity(world, entity);

      assert.strictEqual(isEntityAlive(world, entity), false);
    });

    it("uses swap-and-pop for removal", () => {
      const world = createWorld();

      const e1 = createEntity(world);
      const e2 = createEntity(world);
      const e3 = createEntity(world);

      destroyEntity(world, e2);

      // e3 should be swapped to e2's position
      assert.strictEqual(isEntityAlive(world, e1), true);
      assert.strictEqual(isEntityAlive(world, e2), false);
      assert.strictEqual(isEntityAlive(world, e3), true);
    });
  });

  describe("Entity Validation", () => {
    it("throws on ensureEntity for destroyed entities", () => {
      const world = createWorld();
      const entity = createEntity(world);

      destroyEntity(world, entity);

      assert.throws(() => {
        ensureEntity(world, entity);
      }, NotFound);
    });
  });

  describe("ID Recycling", () => {
    it("recycles destroyed entity IDs with incremented generation", () => {
      const world = createWorld();

      const entity1 = createEntity(world);
      const rawId1 = extractId(entity1);
      const gen1 = extractMeta(entity1);

      destroyEntity(world, entity1);

      const entity2 = createEntity(world);
      const rawId2 = extractId(entity2);
      const gen2 = extractMeta(entity2);

      // Same raw ID, different generation
      assert.strictEqual(rawId1, rawId2);
      assert.strictEqual(gen2, gen1 + 1);
    });

    it("prevents use-after-free via generation check", () => {
      const world = createWorld();

      const oldEntity = createEntity(world);
      destroyEntity(world, oldEntity);

      const newEntity = createEntity(world);

      // Old entity ID should not be alive (different generation)
      assert.strictEqual(isEntityAlive(world, oldEntity), false);
      assert.strictEqual(isEntityAlive(world, newEntity), true);
    });

    it("allocates new ID when no dead entities available", () => {
      const world = createWorld();
      const registry = world.entities;
      // World starts with 1 entity (NameRegistry resource)
      const initialSize = registry.byId.size;

      createEntity(world);
      createEntity(world);

      // No dead entities - should allocate new IDs
      assert.strictEqual(registry.byId.size, initialSize + 2);
      assert.strictEqual(registry.freeIds.length, 0);
      assert.strictEqual(registry.nextId, 3);
    });
  });

  describe("Generations Map", () => {
    it("populates generations map on new entity creation", () => {
      const world = createWorld();

      const entity = createEntity(world);
      const rawId = extractId(entity);

      // New entity should have generation 0 in map
      assert.strictEqual(world.entities.generations.get(rawId), 0);
    });

    it("updates generations map on entity destruction", () => {
      const world = createWorld();

      const entity = createEntity(world);
      const rawId = extractId(entity);

      destroyEntity(world, entity);

      // Generation should be incremented in map
      assert.strictEqual(world.entities.generations.get(rawId), 1);
    });

    it("uses generation from map when recycling entity", () => {
      const world = createWorld();

      const entity1 = createEntity(world);
      const rawId = extractId(entity1);

      // Destroy and recreate multiple times
      destroyEntity(world, entity1);
      const entity2 = createEntity(world);
      assert.strictEqual(extractMeta(entity2), 1);
      assert.strictEqual(world.entities.generations.get(rawId), 1);

      destroyEntity(world, entity2);
      const entity3 = createEntity(world);
      assert.strictEqual(extractMeta(entity3), 2);
      assert.strictEqual(world.entities.generations.get(rawId), 2);
    });

    it("tracks generations for multiple entities independently", () => {
      const world = createWorld();

      const e1 = createEntity(world);
      const e2 = createEntity(world);
      const rawId1 = extractId(e1);
      const rawId2 = extractId(e2);

      // Both start at generation 0
      assert.strictEqual(world.entities.generations.get(rawId1), 0);
      assert.strictEqual(world.entities.generations.get(rawId2), 0);

      // Destroy only e1
      destroyEntity(world, e1);
      assert.strictEqual(world.entities.generations.get(rawId1), 1);
      assert.strictEqual(world.entities.generations.get(rawId2), 0);
    });
  });

  describe("Edge Cases", () => {
    it("wraps generation at 256 through recycling", () => {
      const world = createWorld();

      // Create and destroy entity 256 times to cycle through all generations
      let entity = createEntity(world);
      const rawId = extractId(entity);

      for (let i = 0; i < 256; i++) {
        destroyEntity(world, entity);
        entity = createEntity(world);
      }

      // After 256 cycles, generation should wrap back to 0
      assert.strictEqual(extractId(entity), rawId);
      assert.strictEqual(extractMeta(entity), 0);
    });

    it("enforces max entity ID limit", () => {
      const world = createWorld();

      // Create entities up to the limit
      for (let i = 0; i < ID_MASK_20; i++) {
        createEntity(world);
      }

      // Next entity should throw
      assert.throws(() => {
        createEntity(world);
      }, LimitExceeded);
    });
  });

  describe("Archetype Tracking", () => {
    it("places new entities in root archetype", () => {
      const world = createWorld();
      const entity = createEntity(world);

      const registry = world.entities;
      const meta = registry.byId.get(entity)!;

      // Entity should be in root archetype (empty hash)
      assert.strictEqual(meta.archetype.hash, world.archetypes.root.hash);
    });

    it("tracks multiple entities in root archetype", () => {
      const world = createWorld();
      const e1 = createEntity(world);
      const e2 = createEntity(world);
      const e3 = createEntity(world);

      const registry = world.entities;
      const rootHash = world.archetypes.root.hash;

      // All entities should be in root archetype
      const meta1 = registry.byId.get(e1)!;
      const meta2 = registry.byId.get(e2)!;
      const meta3 = registry.byId.get(e3)!;

      assert.strictEqual(meta1.archetype.hash, rootHash);
      assert.strictEqual(meta2.archetype.hash, rootHash);
      assert.strictEqual(meta3.archetype.hash, rootHash);
    });

    it("initializes empty records array for new entities", () => {
      const world = createWorld();
      const entity = createEntity(world);

      const registry = world.entities;
      const meta = registry.byId.get(entity)!;

      // Records should be empty array (entity not used as component)
      assert.ok(Array.isArray(meta.records));
      assert.strictEqual(meta.records.length, 0);
    });

    it("adds entity to root archetype entities array", () => {
      const world = createWorld();
      const entity = createEntity(world);

      const rootArchetype = world.archetypes.root;

      // Entity should be in root archetype entities array
      assert.strictEqual(rootArchetype.entities.length, 1);
      assert.strictEqual(rootArchetype.entities[0], entity);
    });

    it("removes entity from archetype entities array on destroy", () => {
      const world = createWorld();
      const entity = createEntity(world);

      const rootArchetype = world.archetypes.root;
      assert.strictEqual(rootArchetype.entities.length, 1);

      destroyEntity(world, entity);

      // Entity should be removed from root archetype entities array
      assert.strictEqual(rootArchetype.entities.length, 0);
    });

    it("handles archetype entities cleanup with swap-and-pop", () => {
      const world = createWorld();
      const e1 = createEntity(world);
      const e2 = createEntity(world);
      const e3 = createEntity(world);

      const rootArchetype = world.archetypes.root;
      assert.strictEqual(rootArchetype.entities.length, 3);

      // Destroy middle entity
      destroyEntity(world, e2);

      // e3 should be swapped to e2's position, length decremented
      assert.strictEqual(rootArchetype.entities.length, 2);
      assert.strictEqual(rootArchetype.entities[0], e1);
      assert.strictEqual(rootArchetype.entities[1], e3);
    });

    it("uses meta.get() for entity metadata lookup", () => {
      const world = createWorld();
      const entity = createEntity(world);

      const registry = world.entities;

      // Verify meta.get() returns correct EntityMeta
      const meta = registry.byId.get(entity);
      assert.ok(meta !== undefined);
      assert.ok(typeof meta === "object");

      // Verify archetype tracking uses direct reference
      assert.ok(meta.archetype);
      assert.strictEqual(typeof meta.archetype.hash, "string");
      assert.strictEqual(typeof meta.row, "number");
      assert.ok(meta.row >= 0);
    });

    it("creates fresh metadata for recycled entities", () => {
      const world = createWorld();
      const entity1 = createEntity(world);

      const registry = world.entities;
      const rawId1 = extractId(entity1);

      destroyEntity(world, entity1);

      // Metadata deleted after destruction
      assert.strictEqual(registry.byId.get(entity1), undefined);

      const entity2 = createEntity(world);
      const rawId2 = extractId(entity2);

      // Recycled entity reuses same raw ID with fresh metadata
      assert.strictEqual(rawId1, rawId2);
      const meta2 = registry.byId.get(entity2)!;
      assert.ok(meta2);
      assert.strictEqual(meta2.archetype.hash, world.archetypes.root.hash);
      assert.strictEqual(meta2.row, 0);
    });
  });

  describe("Component Schema Registration", () => {
    it("stores schema in EntityMeta on auto-registration", () => {
      const world = createWorld();
      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });

      // Component not yet registered in world
      assert.strictEqual(world.entities.byId.has(Position), false);

      // ensureEntity auto-registers component with schema
      const meta = ensureEntity(world, Position);

      assert.ok(meta);
      assert.ok(meta.schema);
      assert.ok(meta.schema.x);
      assert.ok(meta.schema.y);
    });

    it("retrieves schema from EntityMeta after registration", () => {
      const world = createWorld();
      const Velocity = defineComponent("Velocity", {
        x: Type.f32(),
        y: Type.f32(),
      });

      // Trigger auto-registration
      const entity = createEntity(world);
      addComponent(world, entity, Velocity, { x: 1.0, y: 2.0 });

      // Schema should be in EntityMeta
      const meta = world.entities.byId.get(Velocity);
      assert.ok(meta);
      assert.ok(meta.schema);
      assert.strictEqual(Object.keys(meta.schema).length, 2);
    });

    it("auto-registers component on first use", () => {
      const world = createWorld();
      const Score = defineComponent("Score", { value: Type.i32() });

      assert.strictEqual(world.entities.byId.has(Score), false);

      const entity = createEntity(world);
      addComponent(world, entity, Score, { value: 100 });

      assert.strictEqual(world.entities.byId.has(Score), true);
    });

    it("stores schema for multiple component types", () => {
      const world = createWorld();
      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });
      const Health = defineComponent("Health", { current: Type.i32(), max: Type.i32() });

      ensureEntity(world, Position);
      ensureEntity(world, Health);

      const positionMeta = world.entities.byId.get(Position)!;
      const healthMeta = world.entities.byId.get(Health)!;

      assert.ok(positionMeta.schema);
      assert.ok(healthMeta.schema);
      assert.strictEqual(Object.keys(positionMeta.schema).length, 2);
      assert.strictEqual(Object.keys(healthMeta.schema).length, 2);
    });

    it("regular entities have no schema", () => {
      const world = createWorld();
      const entity = createEntity(world);

      const meta = world.entities.byId.get(entity)!;

      assert.strictEqual(meta.schema, undefined);
    });

    it("tag component entities have no schema", () => {
      const world = createWorld();
      const Enemy = defineTag("Enemy");

      const meta = ensureEntity(world, Enemy);

      assert.strictEqual(meta.schema, undefined);
    });

    it("auto-registers relation with schema", () => {
      const world = createWorld();
      const Amount = defineRelation("Amount", { schema: { value: Type.f32() } });

      const meta = ensureEntity(world, Amount);

      assert.ok(meta, "Relation should be registered");
      assert.ok(meta.schema, "Relation should have schema");
      assert.ok("value" in meta.schema, "Schema should have 'value' field");
    });

    it("auto-registers relation without schema", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");

      const meta = ensureEntity(world, ChildOf);

      assert.ok(meta, "Relation should be registered");
      assert.strictEqual(meta.schema, undefined, "Tag relation should have no schema");
    });

    it("auto-registers Wildcard relation", () => {
      const world = createWorld();
      const meta = ensureEntity(world, Wildcard);

      assert.ok(meta, "Wildcard should be registered");
    });

    it("auto-registers pair with inherited schema from relation", () => {
      const world = createWorld();
      const Amount = defineRelation("Amount", { schema: { value: Type.f32() } });
      const target = createEntity(world);
      const pairId = pair(Amount, target);

      const meta = ensureEntity(world, pairId);

      assert.ok(meta, "Pair should be registered");
      assert.ok(meta.schema, "Pair should have schema");
      assert.ok("value" in meta.schema, "Schema should have 'value' field");
    });

    it("auto-registers pair without schema for tag relation", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const target = createEntity(world);
      const pairId = pair(ChildOf, target);

      const meta = ensureEntity(world, pairId);

      assert.ok(meta, "Pair should be registered");
      assert.strictEqual(meta.schema, undefined, "Tag relation pair should have no schema");
    });

    it("auto-registers relation when pair is registered", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const target = createEntity(world);
      const pairId = pair(ChildOf, target);

      // Relation not yet registered in world
      assert.ok(!world.entities.byId.has(ChildOf), "Relation should not be registered yet");

      // Register the pair
      ensureEntity(world, pairId);

      // Relation should now be registered
      assert.ok(world.entities.byId.has(ChildOf), "Relation should be auto-registered with pair");
    });

    it("returns existing meta for already-registered pair", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const target = createEntity(world);
      const pairId = pair(ChildOf, target);

      const meta1 = ensureEntity(world, pairId);
      const meta2 = ensureEntity(world, pairId);

      assert.strictEqual(meta1, meta2, "Should return same metadata object");
    });
  });
});
