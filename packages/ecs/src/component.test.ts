import assert from "node:assert";
import { describe, it } from "node:test";
import {
  addComponent,
  addComponents,
  getComponentValue,
  getComponentVectorValue,
  getComponentVectorView,
  hasComponent,
  markComponentChanged,
  removeComponent,
  removeComponents,
  setComponentValue,
  setComponentVectorValue,
} from "./component.js";
import type { EntityId } from "./encoding.js";
import { encodePair, extractId } from "./encoding.js";
import { createEntity, destroyEntity, ensureEntity, getEntityMeta, isEntityAlive } from "./entity.js";
import { IrisInvalidArgument, IrisNotFound } from "./error.js";
import { registerObserverCallback } from "./observer.js";
import { added, changed, queryEntities } from "./query.js";
import { defineComponent, defineRelation, defineTag, Wildcard } from "./registry.js";
import { pair } from "./relation.js";
import { addSystem, defineSystem, runOnce } from "./scheduler.js";
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

      // Entity starts in root archetype
      const meta = getEntityMeta(world, entity1)!;
      assert.strictEqual(meta.archetype, world.archetypes.root);

      // Add component transitions to new archetype
      addComponent(world, entity1, entity2);

      const metaAfter = getEntityMeta(world, entity1)!;
      assert.notStrictEqual(metaAfter.archetype, world.archetypes.root);

      // Verify archetype contains component
      assert.strictEqual(metaAfter.archetype.typesSet.has(entity2), true);
    });

    it("is idempotent (no-op if component already present)", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      addComponent(world, entity1, entity2);

      // Get archetype after first add
      const meta1 = getEntityMeta(world, entity1)!;
      const archetype1 = meta1.archetype;

      // Add again (should be no-op)
      addComponent(world, entity1, entity2);

      // Archetype should be unchanged
      const meta2 = getEntityMeta(world, entity1)!;
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
      }, IrisNotFound);
    });

    it("narrows the entity for typed accessors", () => {
      const world = createWorld();
      const Position = defineComponent("ca_narrow_Position", { x: Type.f32(), y: Type.f32() });
      const entity = createEntity(world);

      addComponent(world, entity, Position, { x: 1, y: 2 });

      const x: number = getComponentValue(world, entity, Position, "x");
      assert.strictEqual(x, 1);
    });

    it("narrows the entity for typed pair accessors", () => {
      const world = createWorld();
      const Amount = defineRelation("ca_narrow_Amount", { schema: { value: Type.f32() } });
      const entity = createEntity(world);
      const target = createEntity(world);

      addComponent(world, entity, pair(Amount, target), { value: 42 });

      const value: number = getComponentValue(world, entity, pair(Amount, target), "value");
      assert.strictEqual(value, 42);
    });
  });

  describe("Batch Component Add", () => {
    it("adds multiple data components with correct values", () => {
      const world = createWorld();
      const Position = defineComponent("ba_Position", { x: Type.f32<10>(), y: Type.f32() });
      const Velocity = defineComponent("ba_Velocity", { vx: Type.f32(), vy: Type.f32() });
      const entity = createEntity(world);

      addComponents(world, entity, [
        [Position, { x: 10, y: 20 }],
        [Velocity, { vx: 1, vy: 2 }],
      ]);

      assert.strictEqual(hasComponent(world, entity, Position), true);
      assert.strictEqual(hasComponent(world, entity, Velocity), true);
      assert.strictEqual(getComponentValue(world, entity, Position, "y"), 20);
      assert.strictEqual(getComponentValue(world, entity, Velocity, "vx"), 1);
      assert.strictEqual(getComponentValue(world, entity, Velocity, "vy"), 2);

      const x: 10 | undefined = getComponentValue(world, entity, Position, "x");
      assert.strictEqual(x, 10);
    });

    it("adds mix of tags and data components", () => {
      const world = createWorld();
      const Player = defineTag("ba_Player");
      const Position = defineComponent("ba_mix_Position", { x: Type.f32(), y: Type.f32() });
      const entity = createEntity(world);

      addComponents(world, entity, [Player, [Position, { x: 5, y: 10 }]]);

      assert.strictEqual(hasComponent(world, entity, Player), true);
      assert.strictEqual(hasComponent(world, entity, Position), true);
      assert.strictEqual(getComponentValue(world, entity, Position, "x"), 5);
      assert.strictEqual(getComponentValue(world, entity, Position, "y"), 10);
    });

    it("adds pairs with and without schemas", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ba_ChildOf");
      const Amount = defineRelation("ba_Amount", { schema: { value: Type.f32() } });
      const entity = createEntity(world);
      const parent = createEntity(world);
      const target = createEntity(world);

      addComponents(world, entity, [pair(ChildOf, parent), [pair(Amount, target), { value: 42 }]]);

      assert.strictEqual(hasComponent(world, entity, pair(ChildOf, parent)), true);
      assert.strictEqual(hasComponent(world, entity, pair(Amount, target)), true);
      assert.strictEqual(getComponentValue(world, entity, pair(Amount, target), "value"), 42);
    });

    it("handles empty entries array", () => {
      const world = createWorld();
      const entity = createEntity(world);

      const metaBefore = getEntityMeta(world, entity)!;
      const archBefore = metaBefore.archetype;

      addComponents(world, entity, []);

      const metaAfter = getEntityMeta(world, entity)!;
      assert.strictEqual(metaAfter.archetype, archBefore);
    });

    it("is idempotent for duplicate components in entries", () => {
      const world = createWorld();
      const Player = defineTag("ba_idem_Player");
      const entity = createEntity(world);

      addComponents(world, entity, [Player, Player]);

      assert.strictEqual(hasComponent(world, entity, Player), true);
    });

    it("works with a single entry", () => {
      const world = createWorld();
      const Player = defineTag("ba_single_Player");
      const entity = createEntity(world);

      addComponents(world, entity, [Player]);

      assert.strictEqual(hasComponent(world, entity, Player), true);
    });

    it("narrows the entity for every entry", () => {
      const world = createWorld();
      const Player = defineTag("ba_narrow_Player");
      const Position = defineComponent("ba_narrow_Position", { x: Type.f32(), y: Type.f32() });
      const Velocity = defineComponent("ba_narrow_Velocity", { vx: Type.f32(), vy: Type.f32() });
      const entity = createEntity(world);

      addComponents(world, entity, [Player, [Position, { x: 1, y: 2 }], [Velocity, { vx: 3, vy: 4 }]]);

      const x: number = getComponentValue(world, entity, Position, "x");
      const vx: number = getComponentValue(world, entity, Velocity, "vx");
      assert.strictEqual(x, 1);
      assert.strictEqual(vx, 3);
    });

    it("observers see the whole batch applied when added events fire", () => {
      const world = createWorld();
      const Position = defineComponent("ba_obs_Position", { x: Type.f32(), y: Type.f32() });
      const Player = defineTag("ba_obs_Player");
      const entity = createEntity(world);

      // Every callback already sees the full non-pair batch on the entity
      const sawBoth: boolean[] = [];
      registerObserverCallback(world, "componentAdded", (_componentId, observedEntity) => {
        if (observedEntity === entity) {
          sawBoth.push(hasComponent(world, entity, Position) && hasComponent(world, entity, Player));
        }
      });

      addComponents(world, entity, [[Position, { x: 1, y: 2 }], Player]);

      assert.deepStrictEqual(sawBoth, [true, true]);
    });

    it("keeps existing data for components already present and fires no added event", () => {
      const world = createWorld();
      const Position = defineComponent("ba_keep_Position", { x: Type.f32(), y: Type.f32() });
      const Player = defineTag("ba_keep_Player");
      const entity = createEntity(world);

      addComponent(world, entity, Position, { x: 1, y: 2 });

      let positionAdds = 0;
      registerObserverCallback(world, "componentAdded", (componentId) => {
        if (componentId === Position) {
          positionAdds++;
        }
      });

      addComponents(world, entity, [[Position, { x: 9, y: 9 }], Player]);

      assert.strictEqual(getComponentValue(world, entity, Position, "x"), 1);
      assert.strictEqual(positionAdds, 0);
      assert.strictEqual(hasComponent(world, entity, Player), true);
    });

    it("applies only the first of duplicate data entries", () => {
      const world = createWorld();
      const Position = defineComponent("ba_dup_Position", { x: Type.f32(), y: Type.f32() });
      const entity = createEntity(world);

      let addedCount = 0;
      registerObserverCallback(world, "componentAdded", (componentId) => {
        if (componentId === Position) {
          addedCount++;
        }
      });

      addComponents(world, entity, [
        [Position, { x: 1, y: 2 }],
        [Position, { x: 9, y: 9 }],
      ]);

      assert.strictEqual(getComponentValue(world, entity, Position, "x"), 1);
      assert.strictEqual(addedCount, 1);
    });

    it("fires added events in entry order when pairs come first", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ba_order_ChildOf");
      const Player = defineTag("ba_order_Player");
      const entity = createEntity(world);
      const parent = createEntity(world);

      const order: EntityId[] = [];
      registerObserverCallback(world, "componentAdded", (componentId, observedEntity) => {
        if (observedEntity === entity) {
          order.push(componentId);
        }
      });

      addComponents(world, entity, [pair(ChildOf, parent), Player]);

      assert.ok(order.indexOf(pair(ChildOf, parent)) < order.indexOf(Player));
    });

    it("feeds added and changed detection for every entry", async () => {
      const world = createWorld();
      const Position = defineComponent("ba_detect_Position", { x: Type.f32(), y: Type.f32() });
      const Player = defineTag("ba_detect_Player");
      const entity = createEntity(world);

      const addedResults: EntityId[][] = [];
      const changedResults: EntityId[][] = [];

      addSystem(
        world,
        defineSystem("tracker", function tracker() {
          const addedBatch: EntityId[] = [];
          const changedBatch: EntityId[] = [];
          queryEntities(world, [added(Player)], (e) => {
            addedBatch.push(e);
          });
          queryEntities(world, [changed(Position)], (e) => {
            changedBatch.push(e);
          });
          addedResults.push(addedBatch);
          changedResults.push(changedBatch);
        })
      );

      addComponents(world, entity, [[Position, { x: 1, y: 2 }], Player]);

      // First frame sees the batch, second frame has nothing new
      await runOnce(world);
      await runOnce(world);

      assert.deepStrictEqual(addedResults, [[entity], []]);
      assert.deepStrictEqual(changedResults, [[entity], []]);
    });

    it("fires changed events only for entries carrying data", () => {
      const world = createWorld();
      const Position = defineComponent("ba_chg_Position", { x: Type.f32(), y: Type.f32() });
      const Player = defineTag("ba_chg_Player");
      const entity = createEntity(world);

      const changedIds: EntityId[] = [];
      registerObserverCallback(world, "componentChanged", (componentId) => {
        changedIds.push(componentId);
      });

      addComponents(world, entity, [[Position, { x: 1, y: 2 }], Player]);

      assert.deepStrictEqual(changedIds, [Position]);
    });

    it("throws for wildcard pair entries", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ba_wild_ChildOf");
      const entity = createEntity(world);

      assert.throws(() => addComponents(world, entity, [encodePair(ChildOf, Wildcard)]), IrisInvalidArgument);
    });

    it("throws for destroyed entities (fail-fast)", () => {
      const world = createWorld();
      const Player = defineTag("ba_dead_Player");
      const entity = createEntity(world);

      destroyEntity(world, entity);

      assert.throws(() => {
        addComponents(world, entity, [Player]);
      }, IrisNotFound);
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

      // Add two components
      addComponent(world, entity1, entity2);
      addComponent(world, entity1, entity3);

      const metaBefore = getEntityMeta(world, entity1)!;
      const hashBefore = metaBefore.archetype.hash;

      // Remove one component
      removeComponent(world, entity1, entity2);

      const metaAfter = getEntityMeta(world, entity1)!;
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

      addComponent(world, entity1, entity2);
      removeComponent(world, entity1, entity2);

      // Should be back in root archetype
      const meta = getEntityMeta(world, entity1)!;
      assert.strictEqual(meta.archetype.hash, world.archetypes.root.hash);
    });

    it("is idempotent (no-op if component not present)", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      // Entity has no components
      const meta1 = getEntityMeta(world, entity1)!;
      const hash1 = meta1.archetype.hash;

      // Remove non-existent component (should be no-op)
      removeComponent(world, entity1, entity2);

      // Archetype should be unchanged
      const meta2 = getEntityMeta(world, entity1)!;
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
      }, IrisNotFound);
    });
  });

  describe("Batch Component Remove", () => {
    it("removes multiple components", () => {
      const world = createWorld();
      const Position = defineComponent("br_Position", { x: Type.f32(), y: Type.f32() });
      const Velocity = defineComponent("br_Velocity", { vx: Type.f32(), vy: Type.f32() });
      const Player = defineTag("br_Player");
      const entity = createEntity(world);

      addComponents(world, entity, [[Position, { x: 1, y: 2 }], [Velocity, { vx: 3, vy: 4 }], Player]);

      removeComponents(world, entity, [Position, Player]);

      assert.strictEqual(hasComponent(world, entity, Position), false);
      assert.strictEqual(hasComponent(world, entity, Player), false);
      assert.strictEqual(hasComponent(world, entity, Velocity), true);
    });

    it("removes pairs alongside components", () => {
      const world = createWorld();
      const ChildOf = defineRelation("br_pair_ChildOf");
      const Player = defineTag("br_pair_Player");
      const entity = createEntity(world);
      const parent = createEntity(world);

      addComponents(world, entity, [Player, pair(ChildOf, parent)]);

      removeComponents(world, entity, [Player, pair(ChildOf, parent)]);

      assert.strictEqual(hasComponent(world, entity, Player), false);
      assert.strictEqual(hasComponent(world, entity, pair(ChildOf, parent)), false);
    });

    it("is idempotent for absent components", () => {
      const world = createWorld();
      const Position = defineComponent("br_idem_Position", { x: Type.f32(), y: Type.f32() });
      const Velocity = defineComponent("br_idem_Velocity", { vx: Type.f32(), vy: Type.f32() });
      const entity = createEntity(world);

      addComponent(world, entity, Position, { x: 1, y: 2 });
      const archetypeBefore = getEntityMeta(world, entity)!.archetype;

      removeComponents(world, entity, [Velocity]);

      assert.strictEqual(getEntityMeta(world, entity)!.archetype, archetypeBefore);
    });

    it("skips absent components while removing present ones", () => {
      const world = createWorld();
      const Position = defineComponent("br_mixed_Position", { x: Type.f32(), y: Type.f32() });
      const Velocity = defineComponent("br_mixed_Velocity", { vx: Type.f32(), vy: Type.f32() });
      const Player = defineTag("br_mixed_Player");
      const entity = createEntity(world);

      addComponents(world, entity, [[Position, { x: 1, y: 2 }], Player]);

      const removedIds: EntityId[] = [];
      registerObserverCallback(world, "componentRemoved", (componentId) => {
        removedIds.push(componentId);
      });

      removeComponents(world, entity, [Position, Velocity, Player]);

      assert.strictEqual(hasComponent(world, entity, Position), false);
      assert.strictEqual(hasComponent(world, entity, Player), false);
      assert.deepStrictEqual(removedIds, [Position, Player]);
    });

    it("fires a single removed event for duplicate entries", () => {
      const world = createWorld();
      const Player = defineTag("br_dup_Player");
      const entity = createEntity(world);

      addComponent(world, entity, Player);

      let removedCount = 0;
      registerObserverCallback(world, "componentRemoved", (componentId) => {
        if (componentId === Player) {
          removedCount++;
        }
      });

      removeComponents(world, entity, [Player, Player]);

      assert.strictEqual(removedCount, 1);
    });

    it("observers see the whole batch removed when removed events fire", () => {
      const world = createWorld();
      const Position = defineComponent("br_obs_Position", { x: Type.f32(), y: Type.f32() });
      const Player = defineTag("br_obs_Player");
      const entity = createEntity(world);

      addComponents(world, entity, [[Position, { x: 1, y: 2 }], Player]);

      // Every callback already sees the entity without the full non-pair batch
      const sawNeither: boolean[] = [];
      registerObserverCallback(world, "componentRemoved", (_componentId, observedEntity) => {
        if (observedEntity === entity) {
          sawNeither.push(!hasComponent(world, entity, Position) && !hasComponent(world, entity, Player));
        }
      });

      removeComponents(world, entity, [Position, Player]);

      assert.deepStrictEqual(sawNeither, [true, true]);
    });

    it("handles empty component list", () => {
      const world = createWorld();
      const entity = createEntity(world);
      const archetypeBefore = getEntityMeta(world, entity)!.archetype;

      removeComponents(world, entity, []);

      assert.strictEqual(getEntityMeta(world, entity)!.archetype, archetypeBefore);
    });

    it("throws for wildcard pairs", () => {
      const world = createWorld();
      const ChildOf = defineRelation("br_wild_ChildOf");
      const entity = createEntity(world);
      const parent = createEntity(world);

      addComponent(world, entity, pair(ChildOf, parent));

      assert.throws(() => removeComponents(world, entity, [encodePair(ChildOf, Wildcard)]), IrisInvalidArgument);
    });

    it("throws for destroyed entities (fail-fast)", () => {
      const world = createWorld();
      const Player = defineTag("br_dead_Player");
      const entity = createEntity(world);

      addComponent(world, entity, Player);
      destroyEntity(world, entity);

      assert.throws(() => removeComponents(world, entity, [Player]), IrisNotFound);
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
      }, IrisNotFound);
    });

    it("throws for never-created entities (fail-fast)", () => {
      const world = createWorld();

      // Should throw for entity IDs not registered in world
      assert.throws(() => {
        hasComponent(world, 999999 as EntityId, 999998 as EntityId);
      }, /Invalid entity type/);
    });
  });

  describe("Entities as Components", () => {
    it("uses entities as components without schema", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      // Entity2 used as component (no schema, no columns)
      addComponent(world, entity1, entity2);

      const meta = getEntityMeta(world, entity1)!;
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
      }, IrisNotFound);

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
      const Marker = defineTag("CleanupMarker");
      const entityA = createEntity(world);
      const entityB = createEntity(world);

      addComponent(world, entityB, Marker);
      addComponent(world, entityB, entityA);

      destroyEntity(world, entityA);

      assert.strictEqual(isEntityAlive(world, entityA), false);
      assert.strictEqual(isEntityAlive(world, entityB), true);
      assert.strictEqual(hasComponent(world, entityB, entityA), false);
      assert.strictEqual(hasComponent(world, entityB, Marker), true);
    });

    it("cascades removal from all entities sharing the component", () => {
      const world = createWorld();
      const entityA = createEntity(world);
      const entityB = createEntity(world);
      const entityC = createEntity(world);

      addComponent(world, entityB, entityA);
      addComponent(world, entityC, entityA);

      destroyEntity(world, entityA);

      assert.strictEqual(isEntityAlive(world, entityB), true);
      assert.strictEqual(isEntityAlive(world, entityC), true);
      assert.strictEqual(hasComponent(world, entityB, entityA), false);
      assert.strictEqual(hasComponent(world, entityC, entityA), false);
    });

    it("handles self-referential component", () => {
      const world = createWorld();
      const entityA = createEntity(world);

      addComponent(world, entityA, entityA);

      destroyEntity(world, entityA);

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

      assert.strictEqual(isEntityAlive(world, Dead), false);

      const entity = createEntity(world);
      addComponent(world, entity, Dead);

      assert.strictEqual(isEntityAlive(world, Dead), true);
    });

    it("registers silently via ensureEntity", () => {
      const world = createWorld();
      const Frozen = defineTag("Frozen");

      assert.strictEqual(isEntityAlive(world, Frozen), false);

      const meta = ensureEntity(world, Frozen);

      assert.ok(meta);
      assert.strictEqual(isEntityAlive(world, Frozen), true);
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
      assert.strictEqual(isEntityAlive(world, Burning), true);

      destroyEntity(world, Burning);
      assert.strictEqual(isEntityAlive(world, Burning), false);
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
      const Name = defineComponent("StringFieldName", { value: Type.string<"Player" | "Enemy">() });

      const entity = createEntity(world);
      addComponent(world, entity, Name, { value: "Player" });

      assert.strictEqual(getComponentValue(world, entity, Name, "value"), "Player");

      setComponentValue(world, entity, Name, "value", "Enemy");
      const value: "Player" | "Enemy" | undefined = getComponentValue(world, entity, Name, "value");
      assert.strictEqual(value, "Enemy");
    });

    it("gets and sets i8 field values", () => {
      const world = createWorld();
      const Stats = defineComponent("Stats", { strength: Type.i8(), dexterity: Type.i8() });

      const entity = createEntity(world);
      addComponent(world, entity, Stats, { strength: 10, dexterity: 15 });

      assert.strictEqual(getComponentValue(world, entity, Stats, "strength"), 10);
      assert.strictEqual(getComponentValue(world, entity, Stats, "dexterity"), 15);

      setComponentValue(world, entity, Stats, "strength", 12);
      assert.strictEqual(getComponentValue(world, entity, Stats, "strength"), 12);
    });

    it("gets and sets reference field values", () => {
      const world = createWorld();
      const Inventory = defineComponent("InventoryRefField", { items: Type.ref<string[]>() });

      const entity = createEntity(world);
      addComponent(world, entity, Inventory, { items: ["sword"] });

      assert.deepStrictEqual(getComponentValue(world, entity, Inventory, "items"), ["sword"]);

      setComponentValue(world, entity, Inventory, "items", ["sword", "shield"]);
      assert.deepStrictEqual(getComponentValue(world, entity, Inventory, "items"), ["sword", "shield"]);
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
      const Position = defineComponent("PositionReturnsUndefinedMissingComponent", { x: Type.f32(), y: Type.f32() });

      const entity = createEntity(world);

      assert.strictEqual(getComponentValue(world, entity, Position, "x"), undefined);
      assert.strictEqual(getComponentValue(world, entity, Position, "y"), undefined);
    });

    it("returns undefined for missing field", () => {
      const world = createWorld();
      const Position = defineComponent("PositionReturnsUndefinedMissingField", { x: Type.f32(), y: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 10.0, y: 20.0 });

      // Access non-existent field
      // @ts-expect-error - Testing invalid field access
      assert.strictEqual(getComponentValue(world, entity, Position, "z"), undefined);
    });

    it("preserves values during archetype transitions", () => {
      const world = createWorld();
      const Position = defineComponent("PositionPreservesValuesDuringArchetypeTransitions", {
        x: Type.f32(),
        y: Type.f32(),
      });
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
      const Position = defineComponent("PositionAddsTagsDataComponentsEntity", { x: Type.f32(), y: Type.f32() });

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
      const Health = defineComponent("HealthStoresTagsDataComponentsArchetype", {
        current: Type.i32(),
        max: Type.i32(),
      });

      const entity = createEntity(world);
      addComponent(world, entity, Enemy);
      addComponent(world, entity, Health, { current: 50, max: 100 });

      const meta = getEntityMeta(world, entity)!;
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

    it("removes tags and components independently", () => {
      const world = createWorld();
      const Active = defineTag("Active");
      const Velocity = defineComponent("VelocityRemovesTagsComponentsIndependently", { x: Type.f32(), y: Type.f32() });

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

      const meta = getEntityMeta(world, entity)!;
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
      const Position = defineComponent("PositionHandlesSetComponentValueSilentlyMissingComponent", {
        x: Type.f32(),
        y: Type.f32(),
      });

      const entity = createEntity(world);

      // setComponentValue should be silent no-op for missing component
      setComponentValue(world, entity, Position, "x", 10.0);

      assert.strictEqual(getComponentValue(world, entity, Position, "x"), undefined);
    });

    it("handles setComponentValue silently for missing field", () => {
      const world = createWorld();
      const Position = defineComponent("PositionHandlesSetComponentValueSilentlyMissingField", {
        x: Type.f32(),
        y: Type.f32(),
      });

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

      world.revision = 2 ** 32 + 10;
      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 0 });

      const meta = getEntityMeta(world, entity)!;
      const ticks = meta.archetype.ticks.get(Position)!;

      assert.strictEqual(ticks.added[meta.row], 2 ** 32 + 10);
      assert.strictEqual(ticks.changed[meta.row], 2 ** 32 + 10);

      world.revision = 2 ** 32 + 25;
      setComponentValue(world, entity, Position, "x", 5);

      assert.strictEqual(ticks.added[meta.row], 2 ** 32 + 10);
      assert.strictEqual(ticks.changed[meta.row], 2 ** 32 + 25);
    });
  });

  // ============================================================================
  // Pair Component Operations
  // ============================================================================

  describe("Pair Add", () => {
    it("throws for wildcard pairs (query patterns, not storable types)", () => {
      const world = createWorld();
      const Owns = defineRelation("OwnsAddThrowsForWildcardPairs");
      const entity = createEntity(world);
      const target = createEntity(world);

      assert.throws(() => addComponent(world, entity, encodePair(Owns, Wildcard)), IrisInvalidArgument);
      assert.throws(() => addComponent(world, entity, encodePair(Wildcard, target)), IrisInvalidArgument);
    });

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

    it("reports newly added wildcard pairs to observers", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfReportsAddedWildcards");
      const Likes = defineRelation("LikesReportsAddedWildcards");
      const child = createEntity(world);
      const parent = createEntity(world);
      const added: EntityId[] = [];

      registerObserverCallback(world, "componentAdded", (componentId, entityId) => {
        if (entityId === child) {
          added.push(componentId);
        }
      });

      addComponent(world, child, pair(ChildOf, parent));
      addComponent(world, child, pair(Likes, parent));

      // pair(Wildcard, parent) is reported once - the second pair inherits it
      assert.deepStrictEqual(added, [
        pair(ChildOf, parent),
        encodePair(Wildcard, parent),
        encodePair(ChildOf, Wildcard),
        pair(Likes, parent),
        encodePair(Likes, Wildcard),
      ]);
    });

    it("shares wildcard pairs across multiple pairs with same target", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfSharesWildcardPairsAcrossMultiplePairsTarget");
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
      const ChildOf = defineRelation("ChildOfSharesWildcardPairsAcrossMultiplePairsRelation");
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
      const ChildOf = defineRelation("ChildOfIdempotentPairComponents");
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
      const ChildOf = defineRelation("ChildOfRemovesWildcardsNoOtherPairsNeedThem");
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

    it("reports removed wildcard pairs to observers", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfReportsRemovedWildcards");
      const Likes = defineRelation("LikesReportsRemovedWildcards");
      const child = createEntity(world);
      const parent = createEntity(world);
      const removals: EntityId[] = [];

      addComponent(world, child, pair(ChildOf, parent));
      addComponent(world, child, pair(Likes, parent));

      registerObserverCallback(world, "componentRemoved", (componentId, entityId) => {
        if (entityId === child) {
          removals.push(componentId);
        }
      });

      removeComponent(world, child, pair(ChildOf, parent));
      removeComponent(world, child, pair(Likes, parent));

      // pair(Wildcard, parent) is reported only once Likes stops needing it
      assert.deepStrictEqual(removals, [
        pair(ChildOf, parent),
        encodePair(ChildOf, Wildcard),
        pair(Likes, parent),
        encodePair(Wildcard, parent),
        encodePair(Likes, Wildcard),
      ]);
    });

    it("keeps wildcard target pair when other pairs share target", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfKeepsWildcardTargetPairOtherPairsShareTarget");
      const Likes = defineRelation("LikesKeepsWildcardTargetPairOtherPairsShareTarget");
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
      const ChildOf = defineRelation("ChildOfKeepsWildcardRelationPairOtherPairsShareRelation");
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

    it("throws for wildcard pairs (maintained automatically)", () => {
      const world = createWorld();
      const Owns = defineRelation("OwnsRemoveThrowsForWildcardPairs");
      const entity = createEntity(world);
      const target = createEntity(world);

      addComponent(world, entity, pair(Owns, target));

      assert.throws(() => removeComponent(world, entity, encodePair(Owns, Wildcard)), IrisInvalidArgument);
      assert.throws(() => removeComponent(world, entity, encodePair(Wildcard, target)), IrisInvalidArgument);
    });

    it("is idempotent for pair components", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfIdempotentPairComponents8");
      const child = createEntity(world);
      const parent = createEntity(world);

      // Remove pair that was never added
      removeComponent(world, child, pair(ChildOf, parent));

      const meta = ensureEntity(world, child);
      assert.strictEqual(meta.archetype, world.archetypes.root);
    });
  });

  // ============================================================================
  // markComponentChanged
  // ============================================================================

  describe("markComponentChanged", () => {
    it("triggers change detection without modifying value", async () => {
      const world = createWorld();
      const Position = defineComponent("PositionEmit", { x: Type.f32(), y: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 0, y: 0 });

      const results: EntityId[][] = [];

      addSystem(
        world,
        defineSystem("tracker", function tracker() {
          const batch: EntityId[] = [];
          queryEntities(world, [changed(Position)], (e) => {
            batch.push(e);
          });
          results.push(batch);
        })
      );

      // First frame: consume initial add
      await runOnce(world);

      // Emit change without using setComponentValue
      markComponentChanged(world, entity, Position);

      // Second frame: should see the change
      await runOnce(world);

      assert.strictEqual(results[1]!.length, 1);
      assert.strictEqual(results[1]![0], entity);
    });

    it("does not announce a component the entity does not have", () => {
      const world = createWorld();
      const Position = defineComponent("PositionEmitAbsent", { x: Type.f32() });
      const entity = createEntity(world);

      let fired = 0;
      registerObserverCallback(world, "componentChanged", () => {
        fired++;
      });

      markComponentChanged(world, entity, Position);

      assert.strictEqual(fired, 0);
    });

    it("updates changed tick in archetype", () => {
      const world = createWorld();
      const Position = defineComponent("PositionEmitTick", { x: Type.f32() });

      world.revision = 10;
      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 0 });

      const meta = getEntityMeta(world, entity)!;
      const ticks = meta.archetype.ticks.get(Position)!;

      assert.strictEqual(ticks.changed[meta.row], 10);

      world.revision = 30;
      markComponentChanged(world, entity, Position);

      assert.strictEqual(ticks.added[meta.row], 10);
      assert.strictEqual(ticks.changed[meta.row], 30);
    });
  });

  // ============================================================================
  // Vector Field Access
  // ============================================================================

  describe("Vector Field Access", () => {
    it("gets vector value as tuple copy", () => {
      const world = createWorld();
      const Position = defineComponent("PositionGetsVectorValueAsTupleCopy", { value: Type.f32(2) });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { value: [10.5, 20.5] });

      const pos = getComponentVectorValue(world, entity, Position, "value");
      assert.deepStrictEqual(pos, [10.5, 20.5]);
    });

    it("returns a copy, not a reference into the column", () => {
      const world = createWorld();
      const Position = defineComponent("PositionReturnsCopyNotReferenceIntoColumn", { value: Type.f32(2) });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { value: [10, 20] });

      const pos = getComponentVectorValue(world, entity, Position, "value")!;
      pos[0] = 999;

      const pos2 = getComponentVectorValue(world, entity, Position, "value");
      assert.deepStrictEqual(pos2, [10, 20]);
    });

    it("sets vector value from tuple", () => {
      const world = createWorld();
      const Position = defineComponent("PositionSetsVectorValueTuple", { value: Type.f32(2) });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { value: [0, 0] });

      setComponentVectorValue(world, entity, Position, "value", [30.5, 40.5]);

      const pos = getComponentVectorValue(world, entity, Position, "value");
      assert.deepStrictEqual(pos, [30.5, 40.5]);
    });

    it("gets vector view as typed array subarray", () => {
      const world = createWorld();
      const Position = defineComponent("PositionGetsVectorViewAsTypedArraySubarray", { value: Type.f32(2) });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { value: [10, 20] });

      const view = getComponentVectorView(world, entity, Position, "value");
      assert.ok(view instanceof Float32Array);
      assert.strictEqual(view.length, 2);
      assert.strictEqual(view[0], 10);
      assert.strictEqual(view[1], 20);
    });

    it("view mutations are visible to get", () => {
      const world = createWorld();
      const Position = defineComponent("PositionViewMutationsAreVisibleGet", { value: Type.f32(2) });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { value: [10, 20] });

      const view = getComponentVectorView(world, entity, Position, "value")!;
      view[0] = 99;
      view[1] = 88;

      const pos = getComponentVectorValue(world, entity, Position, "value");
      assert.deepStrictEqual(pos, [99, 88]);
    });

    it("gets relation pair vector value", () => {
      const world = createWorld();
      const Offset = defineRelation("OffsetGetsRelationPairVectorValue", { schema: { value: Type.f32(2) } });
      const entity = createEntity(world);
      const target = createEntity(world);
      const offset = pair(Offset, target);
      addComponent(world, entity, offset, { value: [10, 20] });

      assert.ok(hasComponent(world, entity, offset));
      const value: [number, number] = getComponentVectorValue(world, entity, offset, "value");
      assert.deepStrictEqual(value, [10, 20]);
    });

    it("sets relation pair vector value", () => {
      const world = createWorld();
      const Offset = defineRelation("OffsetSetsRelationPairVectorValue", { schema: { value: Type.f32(2) } });
      const entity = createEntity(world);
      const target = createEntity(world);
      const offset = pair(Offset, target);
      addComponent(world, entity, offset, { value: [0, 0] });

      setComponentVectorValue(world, entity, offset, "value", [30, 40]);

      assert.deepStrictEqual(getComponentVectorValue(world, entity, offset, "value"), [30, 40]);
    });

    it("gets live relation pair vector view", () => {
      const world = createWorld();
      const Offset = defineRelation("OffsetGetsLiveRelationPairVectorView", { schema: { value: Type.f32(2) } });
      const entity = createEntity(world);
      const target = createEntity(world);
      const offset = pair(Offset, target);
      addComponent(world, entity, offset, { value: [10, 20] });

      assert.ok(hasComponent(world, entity, offset));
      const view: ArrayBufferView = getComponentVectorView(world, entity, offset, "value");
      assert.ok(view instanceof Float32Array);
      view[0] = 99;

      assert.deepStrictEqual(getComponentVectorValue(world, entity, offset, "value"), [99, 20]);
    });

    it("returns undefined for missing relation pair", () => {
      const world = createWorld();
      const Offset = defineRelation("OffsetReturnsUndefinedMissingRelationPair", {
        schema: { value: Type.f32(2) },
      });
      const entity = createEntity(world);
      const target = createEntity(world);
      const offset = pair(Offset, target);

      assert.strictEqual(getComponentVectorValue(world, entity, offset, "value"), undefined);
      assert.strictEqual(getComponentVectorView(world, entity, offset, "value"), undefined);
    });

    it("returns undefined for missing component", () => {
      const world = createWorld();
      const Position = defineComponent("PositionReturnsUndefinedMissingComponent14", { value: Type.f32(2) });

      const entity = createEntity(world);

      assert.strictEqual(getComponentVectorValue(world, entity, Position, "value"), undefined);
      assert.strictEqual(getComponentVectorView(world, entity, Position, "value"), undefined);
    });

    it("set updates change detection tick", async () => {
      const world = createWorld();
      const Position = defineComponent("PositionSetUpdatesChangeDetectionTick", { value: Type.f32(2) });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { value: [0, 0] });

      let changeCount = 0;
      addSystem(
        world,
        defineSystem("counter", function counter() {
          queryEntities(world, [changed(Position)], () => {
            changeCount++;
          });
        })
      );

      await runOnce(world);
      assert.strictEqual(changeCount, 1); // added counts as changed

      await runOnce(world);
      assert.strictEqual(changeCount, 1); // no change

      setComponentVectorValue(world, entity, Position, "value", [1, 2]);
      await runOnce(world);
      assert.strictEqual(changeCount, 2); // changed
    });

    it("supports vec3 (stride 3)", () => {
      const world = createWorld();
      const Position3D = defineComponent("Position3D", { value: Type.f32(3) });

      const entity = createEntity(world);
      addComponent(world, entity, Position3D, { value: [1, 2, 3] });

      const pos = getComponentVectorValue(world, entity, Position3D, "value");
      assert.deepStrictEqual(pos, [1, 2, 3]);

      const view = getComponentVectorView(world, entity, Position3D, "value")!;
      assert.strictEqual(view.length, 3);
    });

    it("supports vec4 (stride 4)", () => {
      const world = createWorld();
      const Color = defineComponent("Color", { value: Type.u32(4) });

      const entity = createEntity(world);
      addComponent(world, entity, Color, { value: [255, 128, 0, 255] });

      const color = getComponentVectorValue(world, entity, Color, "value");
      assert.deepStrictEqual(color, [255, 128, 0, 255]);
    });

    it("mixed scalar and vector fields on same component", () => {
      const world = createWorld();
      const Particle = defineComponent("Particle", {
        position: Type.f32(3),
        mass: Type.f32(),
      });

      const entity = createEntity(world);
      addComponent(world, entity, Particle, { position: [1, 2, 3], mass: 9.8 });

      const pos = getComponentVectorValue(world, entity, Particle, "position");
      assert.deepStrictEqual(pos, [1, 2, 3]);

      const mass = getComponentValue(world, entity, Particle, "mass");
      assert.strictEqual(mass, Math.fround(9.8));
    });

    it("preserves vector data during archetype transitions", () => {
      const world = createWorld();
      const Position = defineComponent("PositionPreservesVectorDataDuringArchetypeTransitions", { value: Type.f32(2) });
      const Velocity = defineComponent("VelocityPreservesVectorDataDuringArchetypeTransitions", { value: Type.f32(2) });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { value: [10, 20] });

      addComponent(world, entity, Velocity, { value: [1, 2] });

      const pos = getComponentVectorValue(world, entity, Position, "value");
      assert.deepStrictEqual(pos, [10, 20]);

      const vel = getComponentVectorValue(world, entity, Velocity, "value");
      assert.deepStrictEqual(vel, [1, 2]);

      removeComponent(world, entity, Position);

      const velAfter = getComponentVectorValue(world, entity, Velocity, "value");
      assert.deepStrictEqual(velAfter, [1, 2]);
    });

    it("handles multiple entities with vector components", () => {
      const world = createWorld();
      const Position = defineComponent("PositionHandlesMultipleEntitiesVectorComponents", { value: Type.f32(2) });

      const entities: EntityId[] = [];
      for (let i = 0; i < 5; i++) {
        const e = createEntity(world);
        addComponent(world, e, Position, { value: [i * 10, i * 10 + 1] });
        entities.push(e);
      }

      for (let i = 0; i < 5; i++) {
        const pos = getComponentVectorValue(world, entities[i]!, Position, "value");
        assert.deepStrictEqual(pos, [i * 10, i * 10 + 1]);
      }
    });
  });
});
