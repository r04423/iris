import assert from "node:assert";
import { describe, it } from "node:test";
import { addComponent, getComponentValue, hasComponent } from "./component.js";
import type { EntityId } from "./encoding.js";
import { extractId, extractMeta, ID_MASK_20 } from "./encoding.js";
import { createEntity, destroyEntity, ensureEntity, getEntityMeta, isEntityAlive } from "./entity.js";
import { IrisLimitExceeded, IrisNotFound } from "./error.js";
import { registerObserverCallback } from "./observer.js";
import { defineComponent, defineRelation, Exclusive, OnDeleteTarget, Wildcard } from "./registry.js";
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
  });

  describe("Entity Creation with Components", () => {
    it("creates entity with components in one call", () => {
      const world = createWorld();
      const Player = defineComponent("ce_Player");
      const Position = defineComponent("ce_Position", { schema: { x: Type.f32<10>(), y: Type.f32() } });

      const entity = createEntity(world, [Player, [Position, { x: 10, y: 20 }]]);

      assert.strictEqual(isEntityAlive(world, entity), true);
      assert.strictEqual(hasComponent(world, entity, Player), true);
      assert.strictEqual(hasComponent(world, entity, Position), true);
      const x: 10 = getComponentValue(world, entity, Position, "x");
      assert.strictEqual(x, 10);
      assert.strictEqual(getComponentValue(world, entity, Position, "y"), 20);
    });

    it("narrows the returned entity for every entry", () => {
      const world = createWorld();
      const Player = defineComponent("ce_narrow_Player");
      const Position = defineComponent("ce_narrow_Position", { schema: { x: Type.f32(), y: Type.f32() } });
      const Amount = defineRelation("ce_narrow_Amount", { schema: { value: Type.f32() } });
      const target = createEntity(world);

      const entity = createEntity(world, [Player, [Position, { x: 1, y: 2 }], [pair(Amount, target), { value: 3 }]]);

      const x: number = getComponentValue(world, entity, Position, "x");
      const value: number = getComponentValue(world, entity, pair(Amount, target), "value");
      assert.strictEqual(x, 1);
      assert.strictEqual(value, 3);
    });

    it("creates entity with pair entries", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ce_ChildOf");
      const parent = createEntity(world);

      const child = createEntity(world, [pair(ChildOf, parent)]);

      assert.strictEqual(isEntityAlive(world, child), true);
      assert.strictEqual(hasComponent(world, child, pair(ChildOf, parent)), true);
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
    it("recycles only the target's ID when destroying a relation target", () => {
      const world = createWorld();
      const Owns = defineRelation("entity.test.OwnsRecycle");

      const target = createEntity(world);
      const subject = createEntity(world);
      addComponent(world, subject, pair(Owns, target));

      destroyEntity(world, target);

      assert.strictEqual(isEntityAlive(world, subject), true);

      // The next entity reuses the target's raw ID; the one after allocates fresh
      const recycled = createEntity(world);
      assert.strictEqual(extractId(recycled), extractId(target));
      assert.strictEqual(extractMeta(recycled), extractMeta(target) + 1);
      const fresh = createEntity(world);
      assert.strictEqual(extractMeta(fresh), 0);
    });

    it("double destroy is idempotent", () => {
      const world = createWorld();
      const entity = createEntity(world);

      destroyEntity(world, entity);

      // Second destroy should be idempotent (no-op for cascade safety)
      destroyEntity(world, entity);

      assert.strictEqual(isEntityAlive(world, entity), false);
    });

    it("keeps other entities intact when destroying between them", () => {
      const world = createWorld();

      const e1 = createEntity(world);
      const e2 = createEntity(world);
      const e3 = createEntity(world);

      destroyEntity(world, e2);

      assert.strictEqual(isEntityAlive(world, e1), true);
      assert.strictEqual(isEntityAlive(world, e2), false);
      assert.strictEqual(isEntityAlive(world, e3), true);
    });

    it("fires entityDestroying while the entity's component data is still readable", () => {
      const world = createWorld();
      const Position = defineComponent("DestroyingPosition", { schema: { x: Type.f32() } });

      const dying = createEntity(world, [[Position, { x: 1 }]]);
      createEntity(world, [[Position, { x: 2 }]]);

      let observed: number | undefined;
      registerObserverCallback(world, "entityDestroying", (entityId) => {
        observed = getComponentValue(world, entityId, Position, "x");
      });

      destroyEntity(world, dying);

      assert.strictEqual(observed, 1);
    });

    it("fires entityDestroyed once the entity is gone", () => {
      const world = createWorld();
      const Position = defineComponent("DestroyedPosition", { schema: { x: Type.f32() } });

      const dying = createEntity(world, [[Position, { x: 1 }]]);
      createEntity(world, [[Position, { x: 2 }]]);

      let alive: boolean | undefined;
      registerObserverCallback(world, "entityDestroyed", (entityId) => {
        alive = isEntityAlive(world, entityId);
        assert.throws(() => getComponentValue(world, entityId, Position, "x"), IrisNotFound);
      });

      destroyEntity(world, dying);

      assert.strictEqual(alive, false);
    });

    it("fires entityDestroying before entityDestroyed", () => {
      const world = createWorld();
      const entity = createEntity(world);
      const fired: string[] = [];

      registerObserverCallback(world, "entityDestroyed", () => fired.push("entityDestroyed"));
      registerObserverCallback(world, "entityDestroying", () => fired.push("entityDestroying"));

      destroyEntity(world, entity);

      assert.deepStrictEqual(fired, ["entityDestroying", "entityDestroyed"]);
    });
  });

  describe("Entity Validation", () => {
    it("throws on ensureEntity for destroyed entities", () => {
      const world = createWorld();
      const entity = createEntity(world);

      destroyEntity(world, entity);

      assert.throws(() => {
        ensureEntity(world, entity);
      }, IrisNotFound);
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

    it("increments generation on each recycle", () => {
      const world = createWorld();

      const entity1 = createEntity(world);
      destroyEntity(world, entity1);
      const entity2 = createEntity(world);
      assert.strictEqual(extractMeta(entity2), 1);

      destroyEntity(world, entity2);
      const entity3 = createEntity(world);
      assert.strictEqual(extractId(entity3), extractId(entity1));
      assert.strictEqual(extractMeta(entity3), 2);
    });

    it("starts recycled entities with fresh state", () => {
      const world = createWorld();
      const Position = defineComponent("RecycledFreshPosition", { schema: { x: Type.f32() } });

      const entity1 = createEntity(world);
      addComponent(world, entity1, [Position, { x: 1 }]);
      destroyEntity(world, entity1);

      const entity2 = createEntity(world);

      assert.strictEqual(extractId(entity2), extractId(entity1));
      assert.strictEqual(hasComponent(world, entity2, Position), false);
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
      }, IrisLimitExceeded);
    });
  });

  describe("Component Schema Registration", () => {
    it("stores schema in EntityMeta on auto-registration", () => {
      const world = createWorld();
      const Position = defineComponent("Position", { schema: { x: Type.f32(), y: Type.f32() } });

      // Component not yet registered in world
      assert.strictEqual(isEntityAlive(world, Position), false);

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
        schema: {
          x: Type.f32(),
          y: Type.f32(),
        },
      });

      // Trigger auto-registration
      const entity = createEntity(world);
      addComponent(world, entity, [Velocity, { x: 1.0, y: 2.0 }]);

      // Schema should be in EntityMeta
      const meta = getEntityMeta(world, Velocity);
      assert.ok(meta);
      assert.ok(meta.schema);
      assert.strictEqual(Object.keys(meta.schema).length, 2);
    });

    it("auto-registers component on first use", () => {
      const world = createWorld();
      const Score = defineComponent("Score", { schema: { value: Type.i32() } });

      assert.strictEqual(isEntityAlive(world, Score), false);

      const entity = createEntity(world);
      addComponent(world, entity, [Score, { value: 100 }]);

      assert.strictEqual(isEntityAlive(world, Score), true);
    });

    it("stores schema for multiple component types", () => {
      const world = createWorld();
      const Position = defineComponent("PositionStoresSchemaMultipleComponentTypes", {
        schema: { x: Type.f32(), y: Type.f32() },
      });
      const Health = defineComponent("Health", { schema: { current: Type.i32(), max: Type.i32() } });

      ensureEntity(world, Position);
      ensureEntity(world, Health);

      const positionMeta = getEntityMeta(world, Position)!;
      const healthMeta = getEntityMeta(world, Health)!;

      assert.ok(positionMeta.schema);
      assert.ok(healthMeta.schema);
      assert.strictEqual(Object.keys(positionMeta.schema).length, 2);
      assert.strictEqual(Object.keys(healthMeta.schema).length, 2);
    });

    it("regular entities have no schema", () => {
      const world = createWorld();
      const entity = createEntity(world);

      const meta = getEntityMeta(world, entity)!;

      assert.strictEqual(meta.schema, undefined);
    });

    it("tag component entities have no schema", () => {
      const world = createWorld();
      const Enemy = defineComponent("Enemy");

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
      const Amount = defineRelation("AmountAutoRegistersPairInheritedSchemaRelation", {
        schema: { value: Type.f32() },
      });
      const target = createEntity(world);
      const pairId = pair(Amount, target);

      const meta = ensureEntity(world, pairId);

      assert.ok(meta, "Pair should be registered");
      assert.ok(meta.schema, "Pair should have schema");
      assert.ok("value" in meta.schema, "Schema should have 'value' field");
    });

    it("auto-registers pair without schema for tag relation", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfAutoRegistersPairWithoutSchemaTagRelation");
      const target = createEntity(world);
      const pairId = pair(ChildOf, target);

      const meta = ensureEntity(world, pairId);

      assert.ok(meta, "Pair should be registered");
      assert.strictEqual(meta.schema, undefined, "Tag relation pair should have no schema");
    });

    it("auto-registers relation when pair is registered", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfAutoRegistersRelationPairRegistered");
      const target = createEntity(world);
      const pairId = pair(ChildOf, target);

      // Relation not yet registered in world
      assert.ok(!isEntityAlive(world, ChildOf), "Relation should not be registered yet");

      // Register the pair
      ensureEntity(world, pairId);

      // Relation should now be registered
      assert.ok(isEntityAlive(world, ChildOf), "Relation should be auto-registered with pair");
    });

    it("auto-registers definition target when pair is registered", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfAutoRegistersDefinitionTarget");
      const target = defineComponent("TargetAutoRegistersDefinitionTarget");

      ensureEntity(world, pair(ChildOf, target));

      assert.ok(isEntityAlive(world, target), "Tag target should be auto-registered with pair");
    });

    it("throws when pair target entity is not alive", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfThrowsPairTargetNotAlive");
      const target = createEntity(world);

      destroyEntity(world, target);

      assert.throws(() => ensureEntity(world, pair(ChildOf, target)), IrisNotFound);
    });

    it("returns existing meta for already-registered pair", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfReturnsExistingMetaAlreadyRegisteredPair");
      const target = createEntity(world);
      const pairId = pair(ChildOf, target);

      const meta1 = ensureEntity(world, pairId);
      const meta2 = ensureEntity(world, pairId);

      assert.strictEqual(meta1, meta2, "Should return same metadata object");
    });

    it("materializes relation traits as queryable components", () => {
      const world = createWorld();
      const Targeting = defineRelation("TargetingMaterializesTraits", {
        exclusive: true,
        onDeleteTarget: "delete",
      });

      ensureEntity(world, Targeting);

      assert.strictEqual(hasComponent(world, Targeting, Exclusive), true);
      assert.strictEqual(hasComponent(world, Targeting, OnDeleteTarget), true);
    });

    it("materializes no traits for plain relations", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfMaterializesNoTraits");

      ensureEntity(world, ChildOf);

      assert.strictEqual(hasComponent(world, ChildOf, Exclusive), false);
      assert.strictEqual(hasComponent(world, ChildOf, OnDeleteTarget), false);
    });
  });
});
