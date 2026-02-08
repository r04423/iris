import assert from "node:assert";
import { describe, it } from "node:test";
import { createAndRegisterArchetype } from "./archetype.js";
import {
  addComponent,
  emitComponentChanged,
  getComponentValue,
  hasComponent,
  removeComponent,
  setComponentValue,
} from "./component.js";
import type { EntityId } from "./encoding.js";
import { encodePair, extractId } from "./encoding.js";
import { createEntity, destroyEntity, ensureEntity, isEntityAlive } from "./entity.js";
import { changed, fetchEntities } from "./query.js";
import { defineComponent, defineRelation, defineTag, Wildcard } from "./registry.js";
import { pair } from "./relation.js";
import { addSystem, runOnce } from "./scheduler.js";
import { Type } from "./schema.js";
import { createWorld } from "./world.js";

describe("Component", () => {
  describe("Component Add", () => {
    it("adds component to entity", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      addComponent(world, entity1, entity2);

      assert.strictEqual(hasComponent(world, entity1, entity2), true);
    });

    it("moves entity to archetype with component", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);
      const registry = world.entities;

      // Entity starts in root archetype
      const meta = registry.byId.get(entity1)!;
      assert.strictEqual(meta.archetype, world.archetypes.root);

      // Add component transitions to new archetype
      addComponent(world, entity1, entity2);

      const metaAfter = registry.byId.get(entity1)!;
      assert.notStrictEqual(metaAfter.archetype, world.archetypes.root);

      // Verify archetype contains component
      assert.strictEqual(metaAfter.archetype.typesSet.has(entity2), true);
    });

    it("is idempotent (no-op if component already present)", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);
      const registry = world.entities;

      addComponent(world, entity1, entity2);

      // Get archetype after first add
      const meta1 = registry.byId.get(entity1)!;
      const archetype1 = meta1.archetype;

      // Add again (should be no-op)
      addComponent(world, entity1, entity2);

      // Archetype should be unchanged
      const meta2 = registry.byId.get(entity1)!;
      assert.strictEqual(meta2.archetype, archetype1);
    });

    it("handles multiple components on same entity", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);
      const entity3 = createEntity(world);

      addComponent(world, entity1, entity2);
      addComponent(world, entity1, entity3);

      assert.strictEqual(hasComponent(world, entity1, entity2), true);
      assert.strictEqual(hasComponent(world, entity1, entity3), true);
    });

    it("throws for destroyed entities (fail-fast)", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      destroyEntity(world, entity1);

      // Should throw when accessing destroyed entity (fail-fast)
      assert.throws(() => {
        addComponent(world, entity1, entity2);
      }, /Entity .* not registered in world/);
    });
  });

  describe("Component Remove", () => {
    it("removes component from entity", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      addComponent(world, entity1, entity2);
      assert.strictEqual(hasComponent(world, entity1, entity2), true);

      removeComponent(world, entity1, entity2);
      assert.strictEqual(hasComponent(world, entity1, entity2), false);
    });

    it("moves entity to archetype without component", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);
      const entity3 = createEntity(world);
      const registry = world.entities;

      // Add two components
      addComponent(world, entity1, entity2);
      addComponent(world, entity1, entity3);

      const metaBefore = registry.byId.get(entity1)!;
      const hashBefore = metaBefore.archetype.hash;

      // Remove one component
      removeComponent(world, entity1, entity2);

      const metaAfter = registry.byId.get(entity1)!;
      const hashAfter = metaAfter.archetype.hash;
      assert.notStrictEqual(hashBefore, hashAfter);

      // Verify entity2 removed, entity3 remains
      assert.strictEqual(hasComponent(world, entity1, entity2), false);
      assert.strictEqual(hasComponent(world, entity1, entity3), true);
    });

    it("returns to root archetype when removing last component", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);
      const registry = world.entities;

      addComponent(world, entity1, entity2);
      removeComponent(world, entity1, entity2);

      // Should be back in root archetype
      const meta = registry.byId.get(entity1)!;
      assert.strictEqual(meta.archetype.hash, world.archetypes.root.hash);
    });

    it("is idempotent (no-op if component not present)", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);
      const registry = world.entities;

      // Entity has no components
      const meta1 = registry.byId.get(entity1)!;
      const hash1 = meta1.archetype.hash;

      // Remove non-existent component (should be no-op)
      removeComponent(world, entity1, entity2);

      // Archetype should be unchanged
      const meta2 = registry.byId.get(entity1)!;
      assert.strictEqual(meta2.archetype.hash, hash1);
    });

    it("throws for destroyed entities (fail-fast)", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      addComponent(world, entity1, entity2);
      destroyEntity(world, entity1);

      // Should throw when accessing destroyed entity (fail-fast)
      assert.throws(() => {
        removeComponent(world, entity1, entity2);
      }, /Entity .* not registered in world/);
    });
  });

  describe("Component Has", () => {
    it("returns true for present component", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      addComponent(world, entity1, entity2);

      assert.strictEqual(hasComponent(world, entity1, entity2), true);
    });

    it("returns false for absent component", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      assert.strictEqual(hasComponent(world, entity1, entity2), false);
    });

    it("throws for destroyed entities (fail-fast)", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      addComponent(world, entity1, entity2);
      destroyEntity(world, entity1);

      // Should throw when accessing destroyed entity (fail-fast)
      assert.throws(() => {
        hasComponent(world, entity1, entity2);
      }, /Entity .* not registered in world/);
    });

    it("throws for never-created entities (fail-fast)", () => {
      const world = createWorld();

      // Should throw for entity IDs not registered in world
      assert.throws(() => {
        hasComponent(world, 999999 as EntityId, 999998 as EntityId);
      }, /Invalid entity type/);
    });
  });

  describe("Edge Caching", () => {
    it("caches archetype transitions", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);
      const entity3 = createEntity(world);

      // First add creates archetype and caches edge
      addComponent(world, entity1, entity2);

      const rootArchetype = world.archetypes.root;
      const cachedHash = rootArchetype.edges.get(entity2);
      assert.notStrictEqual(cachedHash, undefined);

      // Second add to different entity uses cached edge
      addComponent(world, entity3, entity2);

      // Verify both entities in same archetype (cache reused)
      const registry = world.entities;
      const meta1 = registry.byId.get(entity1)!;
      const meta3 = registry.byId.get(entity3)!;

      assert.strictEqual(meta1.archetype.hash, meta3.archetype.hash);
    });

    it("caches bidirectional edges (add and remove)", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      // Add caches forward edge (root + entity2 -> archetype1)
      addComponent(world, entity1, entity2);

      const rootArchetype = world.archetypes.root;
      const registry = world.entities;
      const meta = registry.byId.get(entity1)!;
      const archetype1 = meta.archetype;

      // Verify forward edge cached (direct reference)
      assert.strictEqual(rootArchetype.edges.get(entity2), archetype1);

      // Verify backward edge cached (archetype1 - entity2 -> root, direct reference)
      assert.strictEqual(archetype1.edges.get(entity2), rootArchetype);
    });
  });

  describe("Entities as Components", () => {
    it("uses entities as components without schema", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      // Entity2 used as component (no schema, no columns)
      addComponent(world, entity1, entity2);

      const registry = world.entities;
      const meta = registry.byId.get(entity1)!;
      const archetype = meta.archetype;

      // Entity2 appears in types
      assert.strictEqual(archetype.types.includes(entity2), true);

      // No columns created (entity2 has no schema)
      const columns = archetype.columns.get(entity2);
      assert.strictEqual(columns, undefined);
    });

    it("creates complex entity relationships", () => {
      const world = createWorld();
      const parent = createEntity(world);
      const child1 = createEntity(world);
      const child2 = createEntity(world);

      // Parent has child1 and child2 as components
      addComponent(world, parent, child1);
      addComponent(world, parent, child2);

      assert.strictEqual(hasComponent(world, parent, child1), true);
      assert.strictEqual(hasComponent(world, parent, child2), true);

      // Child1 has parent as component (bidirectional)
      addComponent(world, child1, parent);

      assert.strictEqual(hasComponent(world, child1, parent), true);
    });
  });

  describe("Integration", () => {
    it("handles multiple entities with different component sets", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);
      const entity3 = createEntity(world);
      const componentA = createEntity(world);
      const componentB = createEntity(world);
      const componentC = createEntity(world);

      // Entity1: A, B
      addComponent(world, entity1, componentA);
      addComponent(world, entity1, componentB);

      // Entity2: B, C
      addComponent(world, entity2, componentB);
      addComponent(world, entity2, componentC);

      // Entity3: A, C
      addComponent(world, entity3, componentA);
      addComponent(world, entity3, componentC);

      // Verify entity1
      assert.strictEqual(hasComponent(world, entity1, componentA), true);
      assert.strictEqual(hasComponent(world, entity1, componentB), true);
      assert.strictEqual(hasComponent(world, entity1, componentC), false);

      // Verify entity2
      assert.strictEqual(hasComponent(world, entity2, componentA), false);
      assert.strictEqual(hasComponent(world, entity2, componentB), true);
      assert.strictEqual(hasComponent(world, entity2, componentC), true);

      // Verify entity3
      assert.strictEqual(hasComponent(world, entity3, componentA), true);
      assert.strictEqual(hasComponent(world, entity3, componentB), false);
      assert.strictEqual(hasComponent(world, entity3, componentC), true);
    });

    it("handles component operations across entity lifecycle", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);
      const component = createEntity(world);

      // Add component
      addComponent(world, entity1, component);
      addComponent(world, entity2, component);

      assert.strictEqual(hasComponent(world, entity1, component), true);
      assert.strictEqual(hasComponent(world, entity2, component), true);

      // Remove from entity1
      removeComponent(world, entity1, component);

      assert.strictEqual(hasComponent(world, entity1, component), false);
      assert.strictEqual(hasComponent(world, entity2, component), true);

      // Destroy entity2
      destroyEntity(world, entity2);

      // Checking hasComponent on destroyed entity throws (fail-fast)
      assert.throws(() => {
        hasComponent(world, entity2, component);
      }, /Entity .* not registered in world/);

      // Add back to entity1
      addComponent(world, entity1, component);

      assert.strictEqual(hasComponent(world, entity1, component), true);
    });
  });

  // ============================================================================
  // Component Cleanup
  // ============================================================================

  describe("Component Cleanup", () => {
    it("cascades component removal when entity used as component is destroyed", () => {
      const world = createWorld();
      const entityA = createEntity(world);
      const entityB = createEntity(world);

      const registry = world.entities;

      // Create archetype with entityA as component
      const archetypeBefore = createAndRegisterArchetype(world, [entityA], new Map());
      const archetypeCountBefore = world.archetypes.byId.size;

      // Manually move entityB into archetype (simulating component add)
      const metaB = registry.byId.get(entityB)!;
      const rootArchetype = world.archetypes.root;

      // Remove from root archetype
      const rootRow = metaB.row;
      rootArchetype.entities.splice(rootRow, 1);

      // Add to new archetype
      metaB.archetype = archetypeBefore;
      metaB.row = archetypeBefore.entities.length;
      archetypeBefore.entities.push(entityB);

      // Destroy entityA (used as component)
      destroyEntity(world, entityA);

      // entityA should be dead
      assert.strictEqual(isEntityAlive(world, entityA), false);

      // entityB should still be alive but moved to root archetype
      assert.strictEqual(isEntityAlive(world, entityB), true);
      const metaBAfter = registry.byId.get(entityB)!;
      assert.strictEqual(metaBAfter.archetype.hash, world.archetypes.root.hash);

      // Invalid archetype should be destroyed
      const archetypeAfter = world.archetypes.byId.get(archetypeBefore.hash);
      assert.strictEqual(archetypeAfter, undefined);

      // Should have fewer archetypes now
      const archetypeCountAfter = world.archetypes.byId.size;
      assert.strictEqual(archetypeCountAfter, archetypeCountBefore - 1);
    });

    it("handles multiple entities with same component", () => {
      const world = createWorld();
      const entityA = createEntity(world);
      const entityB = createEntity(world);
      const entityC = createEntity(world);

      const registry = world.entities;
      const rootArchetype = world.archetypes.root;

      // Create archetype with entityA as component
      const archetype = createAndRegisterArchetype(world, [entityA], new Map());

      // Get metadata for entityB and entityC
      const metaB = registry.byId.get(entityB)!;
      const metaC = registry.byId.get(entityC)!;

      // Remove entityB from root
      const rootRowB = metaB.row;
      rootArchetype.entities.splice(rootRowB, 1);
      // Update entityC's row if it was after entityB
      if (metaC.row > rootRowB) {
        metaC.row--;
      }

      // Remove entityC from root (now at potentially different row)
      const rootRowC = metaC.row;
      rootArchetype.entities.splice(rootRowC, 1);

      // Add both entities to new archetype
      metaB.archetype = archetype;
      metaB.row = archetype.entities.length;
      archetype.entities.push(entityB);

      metaC.archetype = archetype;
      metaC.row = archetype.entities.length;
      archetype.entities.push(entityC);

      // Destroy entityA (used as component by both B and C)
      destroyEntity(world, entityA);

      // Both entityB and entityC should be moved back to root archetype
      assert.strictEqual(isEntityAlive(world, entityB), true);
      assert.strictEqual(isEntityAlive(world, entityC), true);

      const metaBAfter = registry.byId.get(entityB)!;
      const metaCAfter = registry.byId.get(entityC)!;

      assert.strictEqual(metaBAfter.archetype.hash, world.archetypes.root.hash);
      assert.strictEqual(metaCAfter.archetype.hash, world.archetypes.root.hash);

      // Invalid archetype should be destroyed
      assert.strictEqual(world.archetypes.byId.get(archetype.hash), undefined);
    });

    it("handles self-referential component", () => {
      const world = createWorld();
      const entityA = createEntity(world);

      const registry = world.entities;

      // Create archetype where entityA has itself as component
      const archetype = createAndRegisterArchetype(world, [entityA], new Map());
      const metaA = registry.byId.get(entityA)!;
      metaA.archetype = archetype;

      // Destroy entityA (self-referential)
      destroyEntity(world, entityA);

      // entityA should be dead
      assert.strictEqual(isEntityAlive(world, entityA), false);

      // Archetype should be destroyed
      assert.strictEqual(world.archetypes.byId.get(archetype.hash), undefined);
    });

    it("clears records array after cascade removal", () => {
      const world = createWorld();
      const entityA = createEntity(world);

      const registry = world.entities;

      // Create archetype with entityA as component
      createAndRegisterArchetype(world, [entityA], new Map());

      // entityA should have non-empty records (tracked as component)
      const metaA = registry.byId.get(entityA)!;
      assert.ok(metaA.records.length > 0);

      // Destroy entityA
      destroyEntity(world, entityA);

      // Metadata should be deleted (entity destroyed, records cleared)
      assert.strictEqual(registry.byId.get(entityA), undefined);

      // All archetypes using entityA as component should be destroyed
      // (verified by the fact that entityA is no longer alive)
      assert.strictEqual(isEntityAlive(world, entityA), false);
    });
  });

  // ============================================================================
  // Tag Components
  // ============================================================================

  describe("Tag Auto-Registration", () => {
    it("auto-registers on first use in world", () => {
      const world = createWorld();
      const Dead = defineTag("Dead");

      assert.strictEqual(world.entities.byId.has(Dead), false);

      const entity = createEntity(world);
      addComponent(world, entity, Dead);

      assert.strictEqual(world.entities.byId.has(Dead), true);
    });

    it("registers silently via ensureEntity", () => {
      const world = createWorld();
      const Frozen = defineTag("Frozen");

      assert.strictEqual(world.entities.byId.has(Frozen), false);

      const meta = ensureEntity(world, Frozen);

      assert.ok(meta);
      assert.strictEqual(world.entities.byId.has(Frozen), true);
    });

    it("does not fire observer events", () => {
      const world = createWorld();
      const Invisible = defineTag("Invisible");

      let eventFired = false;
      world.observers.entityCreated.callbacks.push(() => {
        eventFired = true;
      });

      ensureEntity(world, Invisible);

      assert.strictEqual(eventFired, false);
    });
  });

  describe("Tag Lifecycle", () => {
    it("allows destroyEntity on tags", () => {
      const world = createWorld();
      const Burning = defineTag("Burning");

      ensureEntity(world, Burning);
      assert.strictEqual(world.entities.byId.has(Burning), true);

      destroyEntity(world, Burning);
      assert.strictEqual(world.entities.byId.has(Burning), false);
    });

    it("does not recycle tag IDs", () => {
      const world = createWorld();
      const Poisoned = defineTag("Poisoned");

      ensureEntity(world, Poisoned);
      destroyEntity(world, Poisoned);

      assert.strictEqual(world.entities.freeIds.length, 0);

      const entity = createEntity(world);
      assert.notStrictEqual(extractId(entity), extractId(Poisoned));
    });
  });

  describe("Tag Usage", () => {
    it("uses same tag across multiple worlds", () => {
      const Stunned = defineTag("Stunned");

      const world1 = createWorld();
      const world2 = createWorld();

      const entity1 = createEntity(world1);
      const entity2 = createEntity(world2);

      addComponent(world1, entity1, Stunned);
      addComponent(world2, entity2, Stunned);

      assert.strictEqual(hasComponent(world1, entity1, Stunned), true);
      assert.strictEqual(hasComponent(world2, entity2, Stunned), true);
    });

    it("adds tag components to entities", () => {
      const world = createWorld();
      const Airborne = defineTag("Airborne");
      const entity = createEntity(world);

      addComponent(world, entity, Airborne);

      assert.strictEqual(hasComponent(world, entity, Airborne), true);
    });

    it("finds entities with tag via query", () => {
      const world = createWorld();
      const Flying = defineTag("Flying");

      const e1 = createEntity(world);
      createEntity(world);
      const e3 = createEntity(world);

      addComponent(world, e1, Flying);
      addComponent(world, e3, Flying);

      const results = [...fetchEntities(world, Flying)];

      assert.strictEqual(results.length, 2);
      assert.ok(results.includes(e1));
      assert.ok(results.includes(e3));
    });
  });

  // ============================================================================
  // Field-Level Access
  // ============================================================================

  describe("Field-Level Access", () => {
    it("gets and sets f32 field values", () => {
      const world = createWorld();
      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 10.5, y: 20.5 });

      assert.strictEqual(getComponentValue(world, entity, Position, "x"), 10.5);
      assert.strictEqual(getComponentValue(world, entity, Position, "y"), 20.5);

      setComponentValue(world, entity, Position, "x", 30.5);
      assert.strictEqual(getComponentValue(world, entity, Position, "x"), 30.5);
    });

    it("gets and sets i32 field values", () => {
      const world = createWorld();
      const Health = defineComponent("Health", { current: Type.i32(), max: Type.i32() });

      const entity = createEntity(world);
      addComponent(world, entity, Health, { current: 80, max: 100 });

      assert.strictEqual(getComponentValue(world, entity, Health, "current"), 80);
      assert.strictEqual(getComponentValue(world, entity, Health, "max"), 100);

      setComponentValue(world, entity, Health, "current", 90);
      assert.strictEqual(getComponentValue(world, entity, Health, "current"), 90);
    });

    it("gets and sets string field values", () => {
      const world = createWorld();
      const Name = defineComponent("Name", { value: Type.string() });

      const entity = createEntity(world);
      addComponent(world, entity, Name, { value: "Player" });

      assert.strictEqual(getComponentValue(world, entity, Name, "value"), "Player");

      setComponentValue(world, entity, Name, "value", "Enemy");
      assert.strictEqual(getComponentValue(world, entity, Name, "value"), "Enemy");
    });

    it("gets and sets i8 field values", () => {
      const world = createWorld();
      const Stats = defineComponent("Stats", { strength: Type.i8(), dexterity: Type.i8() });

      const entity = createEntity(world);
      addComponent(world, entity, Stats, { strength: 10, dexterity: 15 });

      assert.strictEqual(getComponentValue(world, entity, Stats, "strength"), 10);
      assert.strictEqual(getComponentValue(world, entity, Stats, "dexterity"), 15);
    });

    it("gets and sets boolean field values", () => {
      const world = createWorld();
      const Flags = defineComponent("Flags", { active: Type.bool(), visible: Type.bool() });

      const entity = createEntity(world);
      addComponent(world, entity, Flags, { active: true, visible: false });

      assert.strictEqual(getComponentValue(world, entity, Flags, "active"), true);
      assert.strictEqual(getComponentValue(world, entity, Flags, "visible"), false);

      setComponentValue(world, entity, Flags, "visible", true);
      assert.strictEqual(getComponentValue(world, entity, Flags, "visible"), true);
    });

    it("returns undefined for missing component", () => {
      const world = createWorld();
      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });

      const entity = createEntity(world);

      assert.strictEqual(getComponentValue(world, entity, Position, "x"), undefined);
      assert.strictEqual(getComponentValue(world, entity, Position, "y"), undefined);
    });

    it("returns undefined for missing field", () => {
      const world = createWorld();
      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 10.0, y: 20.0 });

      // Access non-existent field
      // @ts-expect-error - Testing invalid field access
      assert.strictEqual(getComponentValue(world, entity, Position, "z"), undefined);
    });

    it("preserves values during archetype transitions", () => {
      const world = createWorld();
      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });
      const Velocity = defineComponent("Velocity", { x: Type.f32(), y: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 10.0, y: 20.0 });

      // Add another component (archetype transition)
      addComponent(world, entity, Velocity, { x: 1.0, y: 1.0 });

      // Position values should be preserved
      assert.strictEqual(getComponentValue(world, entity, Position, "x"), 10.0);
      assert.strictEqual(getComponentValue(world, entity, Position, "y"), 20.0);

      // Remove first component
      removeComponent(world, entity, Position);

      // Velocity values should be preserved
      assert.strictEqual(getComponentValue(world, entity, Velocity, "x"), 1.0);
      assert.strictEqual(getComponentValue(world, entity, Velocity, "y"), 1.0);
    });
  });

  // ============================================================================
  // Mixed Tag and Data Component Usage
  // ============================================================================

  describe("Mixed Tag and Data Component Usage", () => {
    it("adds tags and data components to same entity", () => {
      const world = createWorld();
      const Player = defineTag("Player");
      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Player);
      addComponent(world, entity, Position, { x: 10.0, y: 20.0 });

      assert.strictEqual(hasComponent(world, entity, Player), true);
      assert.strictEqual(hasComponent(world, entity, Position), true);
      assert.strictEqual(getComponentValue(world, entity, Position, "x"), 10.0);
    });

    it("stores tags and data components in same archetype", () => {
      const world = createWorld();
      const Enemy = defineTag("Enemy");
      const Health = defineComponent("Health", { current: Type.i32(), max: Type.i32() });

      const entity = createEntity(world);
      addComponent(world, entity, Enemy);
      addComponent(world, entity, Health, { current: 50, max: 100 });

      const meta = world.entities.byId.get(entity)!;
      const archetype = meta.archetype;

      // Both tag and component in archetype types
      assert.strictEqual(archetype.typesSet.has(Enemy), true);
      assert.strictEqual(archetype.typesSet.has(Health), true);

      // Tag has no schema, component has schema
      assert.strictEqual(archetype.schemas.get(Enemy), undefined);
      assert.ok(archetype.schemas.get(Health));

      // Tag has no columns, component has columns
      assert.strictEqual(archetype.columns.get(Enemy), undefined);
      assert.ok(archetype.columns.get(Health));
    });

    it("queries entities with mixed tags and components", () => {
      const world = createWorld();
      const Alive = defineTag("Alive");
      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });

      const e1 = createEntity(world);
      const e2 = createEntity(world);
      const e3 = createEntity(world);

      addComponent(world, e1, Alive);
      addComponent(world, e1, Position, { x: 1.0, y: 1.0 });

      addComponent(world, e2, Position, { x: 2.0, y: 2.0 });

      addComponent(world, e3, Alive);

      // Query for entities with both Alive and Position
      const results = [...fetchEntities(world, Alive, Position)];

      assert.strictEqual(results.length, 1);
      assert.ok(results.includes(e1));
    });

    it("removes tags and components independently", () => {
      const world = createWorld();
      const Active = defineTag("Active");
      const Velocity = defineComponent("Velocity", { x: Type.f32(), y: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Active);
      addComponent(world, entity, Velocity, { x: 1.0, y: 1.0 });

      removeComponent(world, entity, Active);

      assert.strictEqual(hasComponent(world, entity, Active), false);
      assert.strictEqual(hasComponent(world, entity, Velocity), true);

      removeComponent(world, entity, Velocity);

      assert.strictEqual(hasComponent(world, entity, Velocity), false);
    });
  });

  // ============================================================================
  // Data Component Edge Cases
  // ============================================================================

  describe("Data Component Edge Cases", () => {
    it("handles empty schema", () => {
      const world = createWorld();
      const Marker = defineComponent("Marker", {});

      const entity = createEntity(world);
      addComponent(world, entity, Marker, {});

      assert.strictEqual(hasComponent(world, entity, Marker), true);

      const meta = world.entities.byId.get(entity)!;
      const fieldColumns = meta.archetype.columns.get(Marker);

      // Empty schema means no columns
      assert.ok(fieldColumns);
      assert.strictEqual(Object.keys(fieldColumns).length, 0);
    });

    it("initializes all fields from data", () => {
      const world = createWorld();
      const Transform = defineComponent("Transform", {
        x: Type.f32(),
        y: Type.f32(),
        rotation: Type.f32(),
        scale: Type.f32(),
      });

      const entity = createEntity(world);
      addComponent(world, entity, Transform, { x: 1.0, y: 2.0, rotation: 0.0, scale: 1.0 });

      assert.strictEqual(getComponentValue(world, entity, Transform, "x"), 1.0);
      assert.strictEqual(getComponentValue(world, entity, Transform, "y"), 2.0);
      assert.strictEqual(getComponentValue(world, entity, Transform, "rotation"), 0.0);
      assert.strictEqual(getComponentValue(world, entity, Transform, "scale"), 1.0);
    });

    it("handles multiple entities with same component", () => {
      const world = createWorld();
      const Score = defineComponent("Score", { value: Type.i32() });

      const e1 = createEntity(world);
      const e2 = createEntity(world);

      addComponent(world, e1, Score, { value: 100 });
      addComponent(world, e2, Score, { value: 200 });

      // Values should be independent
      assert.strictEqual(getComponentValue(world, e1, Score, "value"), 100);
      assert.strictEqual(getComponentValue(world, e2, Score, "value"), 200);

      setComponentValue(world, e1, Score, "value", 150);

      assert.strictEqual(getComponentValue(world, e1, Score, "value"), 150);
      assert.strictEqual(getComponentValue(world, e2, Score, "value"), 200);
    });

    it("handles setComponentValue silently for missing component", () => {
      const world = createWorld();
      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });

      const entity = createEntity(world);

      // setComponentValue should be silent no-op for missing component
      setComponentValue(world, entity, Position, "x", 10.0);

      assert.strictEqual(getComponentValue(world, entity, Position, "x"), undefined);
    });

    it("handles setComponentValue silently for missing field", () => {
      const world = createWorld();
      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 10.0, y: 20.0 });

      // setComponentValue should be silent no-op for non-existent field
      // @ts-expect-error - Testing invalid field access
      setComponentValue(world, entity, Position, "z", 30.0);

      assert.strictEqual(getComponentValue(world, entity, Position, "x"), 10.0);
      assert.strictEqual(getComponentValue(world, entity, Position, "y"), 20.0);
    });

    it("setComponentValue updates changed tick in archetype", () => {
      const world = createWorld();
      const Position = defineComponent("PositionTick", { x: Type.f32() });

      world.execution.tick = 10;
      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 0 });

      const meta = world.entities.byId.get(entity)!;
      const ticks = meta.archetype.ticks.get(Position)!;

      assert.strictEqual(ticks.added[meta.row], 10);
      assert.strictEqual(ticks.changed[meta.row], 10);

      world.execution.tick = 25;
      setComponentValue(world, entity, Position, "x", 5);

      assert.strictEqual(ticks.added[meta.row], 10);
      assert.strictEqual(ticks.changed[meta.row], 25);
    });
  });

  // ============================================================================
  // Pair Component Operations
  // ============================================================================

  describe("Pair Add", () => {
    it("adds pair with wildcard pairs for query patterns", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const child = createEntity(world);
      const parent = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent));

      const meta = ensureEntity(world, child);
      const types = meta.archetype.types;

      // Should have: pair(ChildOf, parent), pair(Wildcard, parent), pair(ChildOf, Wildcard)
      assert.strictEqual(types.length, 3);
      assert.ok(meta.archetype.typesSet.has(pair(ChildOf, parent)));
      assert.ok(meta.archetype.typesSet.has(encodePair(Wildcard, parent)));
      assert.ok(meta.archetype.typesSet.has(encodePair(ChildOf, Wildcard)));
    });

    it("shares wildcard pairs across multiple pairs with same target", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const Likes = defineRelation("Likes");
      const entity = createEntity(world);
      const target = createEntity(world);

      addComponent(world, entity, pair(ChildOf, target));
      addComponent(world, entity, pair(Likes, target));

      const meta = ensureEntity(world, entity);
      const types = meta.archetype.types;

      // Both pairs share pair(Wildcard, target)
      // Should have: pair(ChildOf, target), pair(Likes, target), pair(Wildcard, target),
      //              pair(ChildOf, Wildcard), pair(Likes, Wildcard)
      assert.strictEqual(types.length, 5);
      assert.ok(meta.archetype.typesSet.has(encodePair(Wildcard, target)));
    });

    it("shares wildcard pairs across multiple pairs with same relation", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const entity = createEntity(world);
      const parent1 = createEntity(world);
      const parent2 = createEntity(world);

      addComponent(world, entity, pair(ChildOf, parent1));
      addComponent(world, entity, pair(ChildOf, parent2));

      const meta = ensureEntity(world, entity);
      const types = meta.archetype.types;

      // Both pairs share pair(ChildOf, Wildcard)
      // Should have: pair(ChildOf, parent1), pair(ChildOf, parent2), pair(Wildcard, parent1),
      //              pair(Wildcard, parent2), pair(ChildOf, Wildcard)
      assert.strictEqual(types.length, 5);
      assert.ok(meta.archetype.typesSet.has(encodePair(ChildOf, Wildcard)));
    });

    it("is idempotent for pair components", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const child = createEntity(world);
      const parent = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent));
      const metaBefore = ensureEntity(world, child);
      const archetypeBefore = metaBefore.archetype;

      addComponent(world, child, pair(ChildOf, parent));
      const metaAfter = ensureEntity(world, child);

      assert.strictEqual(metaAfter.archetype, archetypeBefore);
    });
  });

  describe("Pair Remove", () => {
    it("removes wildcards when no other pairs need them", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const child = createEntity(world);
      const parent = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent));
      removeComponent(world, child, pair(ChildOf, parent));

      const meta = ensureEntity(world, child);

      // Should return to root archetype (no types)
      assert.strictEqual(meta.archetype.types.length, 0);
      assert.strictEqual(meta.archetype.typesSet.has(encodePair(Wildcard, parent)), false);
      assert.strictEqual(meta.archetype.typesSet.has(encodePair(ChildOf, Wildcard)), false);
    });

    it("keeps wildcard target pair when other pairs share target", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const Likes = defineRelation("Likes");
      const entity = createEntity(world);
      const target = createEntity(world);

      addComponent(world, entity, pair(ChildOf, target));
      addComponent(world, entity, pair(Likes, target));

      // Remove ChildOf but keep Likes (both share target)
      removeComponent(world, entity, pair(ChildOf, target));

      const meta = ensureEntity(world, entity);

      // pair(Wildcard, target) should remain for Likes
      assert.ok(meta.archetype.typesSet.has(encodePair(Wildcard, target)));
      // pair(ChildOf, Wildcard) should be removed
      assert.strictEqual(meta.archetype.typesSet.has(encodePair(ChildOf, Wildcard)), false);
      // pair(Likes, Wildcard) should remain
      assert.ok(meta.archetype.typesSet.has(encodePair(Likes, Wildcard)));
    });

    it("keeps wildcard relation pair when other pairs share relation", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const entity = createEntity(world);
      const parent1 = createEntity(world);
      const parent2 = createEntity(world);

      addComponent(world, entity, pair(ChildOf, parent1));
      addComponent(world, entity, pair(ChildOf, parent2));

      // Remove first parent but keep second (both share relation)
      removeComponent(world, entity, pair(ChildOf, parent1));

      const meta = ensureEntity(world, entity);

      // pair(ChildOf, Wildcard) should remain for parent2
      assert.ok(meta.archetype.typesSet.has(encodePair(ChildOf, Wildcard)));
      // pair(Wildcard, parent1) should be removed
      assert.strictEqual(meta.archetype.typesSet.has(encodePair(Wildcard, parent1)), false);
      // pair(Wildcard, parent2) should remain
      assert.ok(meta.archetype.typesSet.has(encodePair(Wildcard, parent2)));
    });

    it("is idempotent for pair components", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const child = createEntity(world);
      const parent = createEntity(world);

      // Remove pair that was never added
      removeComponent(world, child, pair(ChildOf, parent));

      const meta = ensureEntity(world, child);
      assert.strictEqual(meta.archetype, world.archetypes.root);
    });
  });

  // ============================================================================
  // emitComponentChanged
  // ============================================================================

  describe("emitComponentChanged", () => {
    it("triggers change detection without modifying value", async () => {
      const world = createWorld();
      const Position = defineComponent("PositionEmit", { x: Type.f32(), y: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 0, y: 0 });

      const results: EntityId[][] = [];

      addSystem(world, function tracker() {
        const batch: EntityId[] = [];
        for (const e of fetchEntities(world, changed(Position))) {
          batch.push(e);
        }
        results.push(batch);
      });

      // First frame: consume initial add
      await runOnce(world);

      // Emit change without using setComponentValue
      emitComponentChanged(world, entity, Position);

      // Second frame: should see the change
      await runOnce(world);

      assert.strictEqual(results[1]!.length, 1);
      assert.strictEqual(results[1]![0], entity);
    });

    it("updates changed tick in archetype", () => {
      const world = createWorld();
      const Position = defineComponent("PositionEmitTick", { x: Type.f32() });

      world.execution.tick = 10;
      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 0 });

      const meta = world.entities.byId.get(entity)!;
      const ticks = meta.archetype.ticks.get(Position)!;

      assert.strictEqual(ticks.changed[meta.row], 10);

      world.execution.tick = 30;
      emitComponentChanged(world, entity, Position);

      assert.strictEqual(ticks.added[meta.row], 10);
      assert.strictEqual(ticks.changed[meta.row], 30);
    });
  });
});
