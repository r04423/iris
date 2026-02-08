import assert from "node:assert";
import { describe, it } from "node:test";
import { addComponent, getComponentValue, hasComponent, removeComponent } from "./component.js";
import type { EntityId, Pair } from "./encoding.js";
import { isPair, PAIR_FLAG_SHIFT, TYPE_SHIFT } from "./encoding.js";
import { createEntity, destroyEntity, ensureEntity, isEntityAlive } from "./entity.js";
import { InvalidState } from "./error.js";
import { defineComponent, defineRelation, defineTag, Wildcard } from "./registry.js";
import { getPairRelation, getPairTarget, getRelationTargets, pair } from "./relation.js";
import { Type } from "./schema.js";
import { createWorld } from "./world.js";

describe("Relation", () => {
  describe("pair()", () => {
    it("creates pair from relation and entity target", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const parent = createEntity(world);

      const pairId = pair(ChildOf, parent);

      assert.ok(isPair(pairId), "Pair flag should be set");
    });

    it("creates pair from relation and tag target", () => {
      const Has = defineRelation("Has");
      const Weapon = defineTag("Weapon");

      const pairId = pair(Has, Weapon);

      assert.ok(isPair(pairId), "Pair flag should be set");
    });

    it("creates pair from relation and component target", () => {
      const Requires = defineRelation("Requires");
      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });

      const pairId = pair(Requires, Position);

      assert.ok(isPair(pairId), "Pair flag should be set");
    });

    it("creates pair from relation and relation target", () => {
      const DependsOn = defineRelation("DependsOn");
      const ChildOf = defineRelation("ChildOf");

      const pairId = pair(DependsOn, ChildOf);

      assert.ok(isPair(pairId), "Pair flag should be set");
    });

    it("creates distinct pairs for different targets", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const parent1 = createEntity(world);
      const parent2 = createEntity(world);

      const pair1 = pair(ChildOf, parent1);
      const pair2 = pair(ChildOf, parent2);

      assert.notStrictEqual(pair1, pair2, "Different targets should produce different pairs");
    });

    it("creates distinct pairs for different relations", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const Follows = defineRelation("Follows");
      const target = createEntity(world);

      const pair1 = pair(ChildOf, target);
      const pair2 = pair(Follows, target);

      assert.notStrictEqual(pair1, pair2, "Different relations should produce different pairs");
    });

    it("creates same pair for same relation and target", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const parent = createEntity(world);

      const pair1 = pair(ChildOf, parent);
      const pair2 = pair(ChildOf, parent);

      assert.strictEqual(pair1, pair2, "Same relation+target should produce same pair");
    });
  });

  describe("getPairRelation()", () => {
    it("extracts relation from pair with entity target", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const parent = createEntity(world);
      const pairId = pair(ChildOf, parent);

      const relation = getPairRelation(pairId);

      assert.strictEqual(relation, ChildOf);
    });

    it("extracts relation from pair with tag target", () => {
      const Has = defineRelation("Has");
      const Weapon = defineTag("Weapon");
      const pairId = pair(Has, Weapon);

      const relation = getPairRelation(pairId);

      assert.strictEqual(relation, Has);
    });

    it("extracts relation from pair with component target", () => {
      const Requires = defineRelation("Requires");
      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });
      const pairId = pair(Requires, Position);

      const relation = getPairRelation(pairId);

      assert.strictEqual(relation, Requires);
    });

    it("extracts relation from pair with relation target", () => {
      const DependsOn = defineRelation("DependsOn");
      const ChildOf = defineRelation("ChildOf");
      const pairId = pair(DependsOn, ChildOf);

      const relation = getPairRelation(pairId);

      assert.strictEqual(relation, DependsOn);
    });

    it("extracts Wildcard relation from wildcard pair", () => {
      const world = createWorld();
      const target = createEntity(world);
      const pairId = pair(Wildcard, target);

      const relation = getPairRelation(pairId);

      assert.strictEqual(relation, Wildcard);
    });
  });

  describe("getPairTarget()", () => {
    it("extracts entity target from pair", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const parent = createEntity(world);
      const pairId = pair(ChildOf, parent);

      const target = getPairTarget(world, pairId);

      assert.strictEqual(target, parent);
    });

    it("extracts tag target from pair", () => {
      const world = createWorld();
      const Has = defineRelation("Has");
      const Weapon = defineTag("Weapon");
      const pairId = pair(Has, Weapon);

      const target = getPairTarget(world, pairId);

      assert.strictEqual(target, Weapon);
    });

    it("extracts component target from pair", () => {
      const world = createWorld();
      const Requires = defineRelation("Requires");
      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });
      const pairId = pair(Requires, Position);

      const target = getPairTarget(world, pairId);

      assert.strictEqual(target, Position);
    });

    it("extracts relation target from pair", () => {
      const world = createWorld();
      const DependsOn = defineRelation("DependsOn");
      const ChildOf = defineRelation("ChildOf");
      const pairId = pair(DependsOn, ChildOf);

      const target = getPairTarget(world, pairId);

      assert.strictEqual(target, ChildOf);
    });

    it("extracts Wildcard target from pair", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const pairId = pair(ChildOf, Wildcard);

      const target = getPairTarget(world, pairId);

      assert.strictEqual(target, Wildcard);
    });

    it("returns current generation for entity target", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const parent = createEntity(world);
      const pairId = pair(ChildOf, parent);

      // Extract before any generation changes
      const target1 = getPairTarget(world, pairId);
      assert.strictEqual(target1, parent);
    });

    it("returns new entity after target destroyed and recycled (weak reference)", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");

      // Create and destroy parent to get it recycled
      const parent = createEntity(world);
      const pairId = pair(ChildOf, parent);

      destroyEntity(world, parent);

      // Create new entity that reuses the raw ID
      const newEntity = createEntity(world);

      // getPairTarget returns entity with current generation (weak reference semantics)
      const target = getPairTarget(world, pairId);

      // The target should now be the new entity (same raw ID, new generation)
      assert.strictEqual(target, newEntity, "Pair target should point to recycled entity");
    });

    it("throws for invalid pair target type", () => {
      const world = createWorld();

      // Create a malformed pair with invalid type bits (0x0)
      // Pair format: [1:pairFlag][3:targetType][20:targetRawId][8:relationRawId]
      // Invalid type 0x0 is not Entity, Tag, Component, or Relation
      const invalidTypeBits = 0x0;
      const malformedPair = ((1 << PAIR_FLAG_SHIFT) | (invalidTypeBits << TYPE_SHIFT) | 0) as Pair;

      assert.throws(() => getPairTarget(world, malformedPair), InvalidState);
    });
  });

  describe("Wildcard pairs", () => {
    it("creates pair(Wildcard, target) for reverse lookup pattern", () => {
      const world = createWorld();
      const target = createEntity(world);
      const pairId = pair(Wildcard, target);

      assert.ok(isPair(pairId));
      assert.strictEqual(getPairRelation(pairId), Wildcard);
      assert.strictEqual(getPairTarget(world, pairId), target);
    });

    it("creates pair(relation, Wildcard) for any-target pattern", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const pairId = pair(ChildOf, Wildcard);

      assert.ok(isPair(pairId));
      assert.strictEqual(getPairRelation(pairId), ChildOf);
      assert.strictEqual(getPairTarget(world, pairId), Wildcard);
    });
  });

  describe("getRelationTargets()", () => {
    it("returns all targets for a relation", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const entity = createEntity(world);
      const parent1 = createEntity(world);
      const parent2 = createEntity(world);

      addComponent(world, entity, pair(ChildOf, parent1));
      addComponent(world, entity, pair(ChildOf, parent2));

      const targets = getRelationTargets(world, entity, ChildOf);

      assert.strictEqual(targets.length, 2);
      assert.ok(targets.includes(parent1));
      assert.ok(targets.includes(parent2));
    });

    it("returns empty array when no pairs with relation", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const entity = createEntity(world);

      const targets = getRelationTargets(world, entity, ChildOf);

      assert.strictEqual(targets.length, 0);
    });

    it("excludes targets from other relations", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const Likes = defineRelation("Likes");
      const entity = createEntity(world);
      const parent = createEntity(world);
      const friend = createEntity(world);

      addComponent(world, entity, pair(ChildOf, parent));
      addComponent(world, entity, pair(Likes, friend));

      const targets = getRelationTargets(world, entity, ChildOf);

      assert.strictEqual(targets.length, 1);
      assert.ok(targets.includes(parent));
      assert.strictEqual(targets.includes(friend), false);
    });

    it("excludes wildcard pair from results", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const entity = createEntity(world);
      const parent = createEntity(world);

      addComponent(world, entity, pair(ChildOf, parent));

      const targets = getRelationTargets(world, entity, ChildOf);

      // Should only return parent, not Wildcard
      assert.strictEqual(targets.length, 1);
      assert.strictEqual(targets[0], parent);
    });

    it("works with tag targets", () => {
      const world = createWorld();
      const Has = defineRelation("Has");
      const Weapon = defineTag("Weapon");
      const Armor = defineTag("Armor");
      const entity = createEntity(world);

      addComponent(world, entity, pair(Has, Weapon));
      addComponent(world, entity, pair(Has, Armor));

      const targets = getRelationTargets(world, entity, Has);

      assert.strictEqual(targets.length, 2);
      assert.ok(targets.includes(Weapon));
      assert.ok(targets.includes(Armor));
    });

    it("works with component targets", () => {
      const world = createWorld();
      const Requires = defineRelation("Requires");
      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });
      const Velocity = defineComponent("Velocity", { x: Type.f32(), y: Type.f32() });
      const entity = createEntity(world);

      addComponent(world, entity, pair(Requires, Position));
      addComponent(world, entity, pair(Requires, Velocity));

      const targets = getRelationTargets(world, entity, Requires);

      assert.strictEqual(targets.length, 2);
      assert.ok(targets.includes(Position));
      assert.ok(targets.includes(Velocity));
    });

    it("updates after removing pairs", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const entity = createEntity(world);
      const parent1 = createEntity(world);
      const parent2 = createEntity(world);

      addComponent(world, entity, pair(ChildOf, parent1));
      addComponent(world, entity, pair(ChildOf, parent2));

      removeComponent(world, entity, pair(ChildOf, parent1));

      const targets = getRelationTargets(world, entity, ChildOf);

      assert.strictEqual(targets.length, 1);
      assert.strictEqual(targets[0], parent2);
    });

    it("skips non-pair types in archetype", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfSkipNonPair");
      const Position = defineComponent("PositionSkipNonPair", { x: Type.f32() });
      const entity = createEntity(world);
      const parent = createEntity(world);

      // Entity has both regular component and relation pair
      addComponent(world, entity, Position, { x: 0 });
      addComponent(world, entity, pair(ChildOf, parent));

      // getRelationTargets should only return relation targets, not regular components
      const targets = getRelationTargets(world, entity, ChildOf);

      assert.strictEqual(targets.length, 1);
      assert.strictEqual(targets[0], parent);
    });
  });

  describe("Target Deletion Cleanup", () => {
    it("removes pair from subject when target is destroyed", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const parent = createEntity(world);
      const child = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent));
      assert.ok(hasComponent(world, child, pair(ChildOf, parent)));

      destroyEntity(world, parent);

      // Child should no longer have the pair
      assert.strictEqual(hasComponent(world, child, pair(ChildOf, parent)), false);
      // Child should still exist
      assert.ok(isEntityAlive(world, child));
    });

    it("preserves unaffected pairs when one target is destroyed", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const Likes = defineRelation("Likes");
      const parent = createEntity(world);
      const friend = createEntity(world);
      const entity = createEntity(world);

      addComponent(world, entity, pair(ChildOf, parent));
      addComponent(world, entity, pair(Likes, friend));

      destroyEntity(world, parent);

      // ChildOf pair removed
      assert.strictEqual(hasComponent(world, entity, pair(ChildOf, parent)), false);
      // Likes pair preserved
      assert.ok(hasComponent(world, entity, pair(Likes, friend)));
      assert.strictEqual(getRelationTargets(world, entity, Likes).length, 1);
    });

    it("cleans up multiple subjects targeting the same entity", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const parent = createEntity(world);
      const child1 = createEntity(world);
      const child2 = createEntity(world);
      const child3 = createEntity(world);

      addComponent(world, child1, pair(ChildOf, parent));
      addComponent(world, child2, pair(ChildOf, parent));
      addComponent(world, child3, pair(ChildOf, parent));

      destroyEntity(world, parent);

      // All children lose their ChildOf relationship
      assert.strictEqual(hasComponent(world, child1, pair(ChildOf, parent)), false);
      assert.strictEqual(hasComponent(world, child2, pair(ChildOf, parent)), false);
      assert.strictEqual(hasComponent(world, child3, pair(ChildOf, parent)), false);

      // All children still exist (orphaned but alive)
      assert.ok(isEntityAlive(world, child1));
      assert.ok(isEntityAlive(world, child2));
      assert.ok(isEntityAlive(world, child3));
    });

    it("orphans children when parent is destroyed in hierarchy", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const grandparent = createEntity(world);
      const parent = createEntity(world);
      const child1 = createEntity(world);
      const child2 = createEntity(world);

      addComponent(world, parent, pair(ChildOf, grandparent));
      addComponent(world, child1, pair(ChildOf, parent));
      addComponent(world, child2, pair(ChildOf, parent));

      destroyEntity(world, parent);

      // Children orphaned
      assert.strictEqual(hasComponent(world, child1, pair(ChildOf, parent)), false);
      assert.strictEqual(hasComponent(world, child2, pair(ChildOf, parent)), false);

      // Grandparent unchanged
      assert.ok(isEntityAlive(world, grandparent));
      // Children still alive
      assert.ok(isEntityAlive(world, child1));
      assert.ok(isEntityAlive(world, child2));
    });

    it("cleans up multiple relations to the same target", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const OwnedBy = defineRelation("OwnedBy");
      const Targets = defineRelation("Targets");
      const target = createEntity(world);
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      // Different relations pointing to same target
      addComponent(world, entity1, pair(ChildOf, target));
      addComponent(world, entity1, pair(OwnedBy, target));
      addComponent(world, entity2, pair(Targets, target));

      destroyEntity(world, target);

      // All pairs to target removed
      assert.strictEqual(hasComponent(world, entity1, pair(ChildOf, target)), false);
      assert.strictEqual(hasComponent(world, entity1, pair(OwnedBy, target)), false);
      assert.strictEqual(hasComponent(world, entity2, pair(Targets, target)), false);

      // Entities still alive
      assert.ok(isEntityAlive(world, entity1));
      assert.ok(isEntityAlive(world, entity2));
    });

    it("does nothing when destroyed entity was never a target", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const parent = createEntity(world);
      const child = createEntity(world);
      const unrelated = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent));

      // Destroy entity that was never a target
      destroyEntity(world, unrelated);

      // Existing relationship unchanged
      assert.ok(hasComponent(world, child, pair(ChildOf, parent)));
      assert.ok(isEntityAlive(world, parent));
      assert.ok(isEntityAlive(world, child));
    });
  });

  describe("Wildcard Pair Lifecycle", () => {
    it("removes target wildcard when last pair to target is removed", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const parent = createEntity(world);
      const child = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent));
      // Wildcard pair should exist
      assert.ok(hasComponent(world, child, pair(Wildcard, parent)));

      removeComponent(world, child, pair(ChildOf, parent));
      // No more pairs to parent, wildcard should be gone
      assert.strictEqual(hasComponent(world, child, pair(Wildcard, parent)), false);
    });

    it("preserves target wildcard when other pairs still target same entity", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const Likes = defineRelation("Likes");
      const target = createEntity(world);
      const entity = createEntity(world);

      addComponent(world, entity, pair(ChildOf, target));
      addComponent(world, entity, pair(Likes, target));

      removeComponent(world, entity, pair(ChildOf, target));

      // Still have Likes->target, so wildcard preserved
      assert.ok(hasComponent(world, entity, pair(Wildcard, target)));
      assert.ok(hasComponent(world, entity, pair(Likes, target)));
    });

    it("removes relation wildcard when last pair with relation is removed", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const parent = createEntity(world);
      const child = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent));
      // Relation wildcard should exist
      assert.ok(hasComponent(world, child, pair(ChildOf, Wildcard)));

      removeComponent(world, child, pair(ChildOf, parent));
      // No more ChildOf pairs, relation wildcard should be gone
      assert.strictEqual(hasComponent(world, child, pair(ChildOf, Wildcard)), false);
    });

    it("preserves relation wildcard when other pairs use same relation", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const parent1 = createEntity(world);
      const parent2 = createEntity(world);
      const child = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent1));
      addComponent(world, child, pair(ChildOf, parent2));

      removeComponent(world, child, pair(ChildOf, parent1));

      // Still have ChildOf->parent2, so relation wildcard preserved
      assert.ok(hasComponent(world, child, pair(ChildOf, Wildcard)));
      assert.ok(hasComponent(world, child, pair(ChildOf, parent2)));
    });

    it("cleans up both wildcards correctly in multi-relation scenario", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const Likes = defineRelation("Likes");
      const parent = createEntity(world);
      const friend = createEntity(world);
      const entity = createEntity(world);

      // Multiple relations to different targets
      addComponent(world, entity, pair(ChildOf, parent));
      addComponent(world, entity, pair(Likes, friend));

      // Both wildcards exist
      assert.ok(hasComponent(world, entity, pair(Wildcard, parent)));
      assert.ok(hasComponent(world, entity, pair(ChildOf, Wildcard)));
      assert.ok(hasComponent(world, entity, pair(Wildcard, friend)));
      assert.ok(hasComponent(world, entity, pair(Likes, Wildcard)));

      // Remove one pair
      removeComponent(world, entity, pair(ChildOf, parent));

      // ChildOf wildcards gone
      assert.strictEqual(hasComponent(world, entity, pair(Wildcard, parent)), false);
      assert.strictEqual(hasComponent(world, entity, pair(ChildOf, Wildcard)), false);

      // Likes wildcards preserved
      assert.ok(hasComponent(world, entity, pair(Wildcard, friend)));
      assert.ok(hasComponent(world, entity, pair(Likes, Wildcard)));
    });

    it("cleans up wildcards when target is destroyed", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const parent = createEntity(world);
      const child = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent));
      assert.ok(hasComponent(world, child, pair(Wildcard, parent)));
      assert.ok(hasComponent(world, child, pair(ChildOf, Wildcard)));

      destroyEntity(world, parent);

      // All related wildcards cleaned up
      assert.strictEqual(hasComponent(world, child, pair(Wildcard, parent)), false);
      assert.strictEqual(hasComponent(world, child, pair(ChildOf, Wildcard)), false);
    });

    it("preserves unaffected wildcards when one target destroyed", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");
      const parent1 = createEntity(world);
      const parent2 = createEntity(world);
      const child = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent1));
      addComponent(world, child, pair(ChildOf, parent2));

      destroyEntity(world, parent1);

      // parent1 wildcard gone
      assert.strictEqual(hasComponent(world, child, pair(Wildcard, parent1)), false);
      // parent2 wildcard and relation wildcard preserved
      assert.ok(hasComponent(world, child, pair(Wildcard, parent2)));
      assert.ok(hasComponent(world, child, pair(ChildOf, Wildcard)));
    });
  });

  describe("Exclusive Relations", () => {
    it("removes previous target when adding new pair with exclusive relation", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf", { exclusive: true });
      const parent1 = createEntity(world);
      const parent2 = createEntity(world);
      const child = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent1));
      assert.ok(hasComponent(world, child, pair(ChildOf, parent1)));

      addComponent(world, child, pair(ChildOf, parent2));

      // Old target removed, new target present
      assert.strictEqual(hasComponent(world, child, pair(ChildOf, parent1)), false);
      assert.ok(hasComponent(world, child, pair(ChildOf, parent2)));

      // Only one target for the relation
      const targets = getRelationTargets(world, child, ChildOf);
      assert.strictEqual(targets.length, 1);
      assert.strictEqual(targets[0], parent2);
    });

    it("allows multiple exclusive relations on same entity independently", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf", { exclusive: true });
      const OwnedBy = defineRelation("OwnedBy", { exclusive: true });
      const entity = createEntity(world);
      const parent = createEntity(world);
      const owner = createEntity(world);

      addComponent(world, entity, pair(ChildOf, parent));
      addComponent(world, entity, pair(OwnedBy, owner));

      // Both relations present
      assert.ok(hasComponent(world, entity, pair(ChildOf, parent)));
      assert.ok(hasComponent(world, entity, pair(OwnedBy, owner)));
    });

    it("replaces target for one exclusive relation without affecting another", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf", { exclusive: true });
      const OwnedBy = defineRelation("OwnedBy", { exclusive: true });
      const entity = createEntity(world);
      const parent1 = createEntity(world);
      const parent2 = createEntity(world);
      const owner = createEntity(world);

      addComponent(world, entity, pair(ChildOf, parent1));
      addComponent(world, entity, pair(OwnedBy, owner));

      // Reparent
      addComponent(world, entity, pair(ChildOf, parent2));

      // ChildOf replaced
      assert.strictEqual(hasComponent(world, entity, pair(ChildOf, parent1)), false);
      assert.ok(hasComponent(world, entity, pair(ChildOf, parent2)));

      // OwnedBy unchanged
      assert.ok(hasComponent(world, entity, pair(OwnedBy, owner)));
    });

    it("allows multiple targets for non-exclusive relations", () => {
      const world = createWorld();
      const HasTag = defineRelation("HasTag"); // Non-exclusive by default
      const entity = createEntity(world);
      const tag1 = createEntity(world);
      const tag2 = createEntity(world);
      const tag3 = createEntity(world);

      addComponent(world, entity, pair(HasTag, tag1));
      addComponent(world, entity, pair(HasTag, tag2));
      addComponent(world, entity, pair(HasTag, tag3));

      // All targets present
      assert.ok(hasComponent(world, entity, pair(HasTag, tag1)));
      assert.ok(hasComponent(world, entity, pair(HasTag, tag2)));
      assert.ok(hasComponent(world, entity, pair(HasTag, tag3)));

      const targets = getRelationTargets(world, entity, HasTag);
      assert.strictEqual(targets.length, 3);
    });

    it("preserves data for new target in exclusive data relation", () => {
      const world = createWorld();
      const Targets = defineRelation("Targets", {
        schema: { priority: Type.i8() },
        exclusive: true,
      });
      const turret = createEntity(world);
      const enemy1 = createEntity(world);
      const enemy2 = createEntity(world);

      addComponent(world, turret, pair(Targets, enemy1), { priority: 10 });
      addComponent(world, turret, pair(Targets, enemy2), { priority: 20 });

      // Old pair removed
      assert.strictEqual(hasComponent(world, turret, pair(Targets, enemy1)), false);

      // New pair has correct data
      assert.ok(hasComponent(world, turret, pair(Targets, enemy2)));
      const priority = getComponentValue(world, turret, pair(Targets, enemy2), "priority");
      assert.strictEqual(priority, 20);
    });

    it("is idempotent when re-adding same target", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfIdempotent", { exclusive: true });
      const parent = createEntity(world);
      const child = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent));
      const meta1 = ensureEntity(world, child);
      const archetype1 = meta1.archetype;

      // Re-add same pair
      addComponent(world, child, pair(ChildOf, parent));
      const meta2 = ensureEntity(world, child);
      const archetype2 = meta2.archetype;

      // Should remain in same archetype (idempotent)
      assert.strictEqual(archetype1, archetype2);
      assert.ok(hasComponent(world, child, pair(ChildOf, parent)));
    });

    it("removes old pair and adds new pair atomically during exclusive replacement", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfAtomic", { exclusive: true });
      const parent1 = createEntity(world);
      const parent2 = createEntity(world);
      const child = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent1));

      // After replacement, entity should be in consistent state
      addComponent(world, child, pair(ChildOf, parent2));

      // Verify final state is consistent
      const targets = getRelationTargets(world, child, ChildOf);
      assert.strictEqual(targets.length, 1, "Should have exactly one target");
      assert.strictEqual(targets[0], parent2, "Should be new target");

      // Entity should be alive and queryable
      assert.ok(isEntityAlive(world, child));
    });

    it("cleans up wildcards correctly during exclusive replacement", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfWildcards", { exclusive: true });
      const parent1 = createEntity(world);
      const parent2 = createEntity(world);
      const child = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent1));
      assert.ok(hasComponent(world, child, pair(Wildcard, parent1)));
      assert.ok(hasComponent(world, child, pair(ChildOf, Wildcard)));

      // Replace parent
      addComponent(world, child, pair(ChildOf, parent2));

      // Old wildcard gone, new one present
      assert.strictEqual(hasComponent(world, child, pair(Wildcard, parent1)), false);
      assert.ok(hasComponent(world, child, pair(Wildcard, parent2)));

      // Relation wildcard preserved (still has a ChildOf pair)
      assert.ok(hasComponent(world, child, pair(ChildOf, Wildcard)));
    });

    it("preserves other relations when exclusive replacement occurs", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfPreserve", { exclusive: true });
      const Likes = defineRelation("Likes");
      const parent1 = createEntity(world);
      const parent2 = createEntity(world);
      const friend = createEntity(world);
      const entity = createEntity(world);

      addComponent(world, entity, pair(ChildOf, parent1));
      addComponent(world, entity, pair(Likes, friend));

      // Reparent
      addComponent(world, entity, pair(ChildOf, parent2));

      // ChildOf replaced
      assert.strictEqual(hasComponent(world, entity, pair(ChildOf, parent1)), false);
      assert.ok(hasComponent(world, entity, pair(ChildOf, parent2)));

      // Likes unchanged
      assert.ok(hasComponent(world, entity, pair(Likes, friend)));
    });

    it("handles reparenting then destroying old parent correctly", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfReparent", {
        exclusive: true,
        onDeleteTarget: "delete",
      });
      const parent1 = createEntity(world);
      const parent2 = createEntity(world);
      const child = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent1));

      // Reparent to parent2
      addComponent(world, child, pair(ChildOf, parent2));

      // Destroy old parent - should NOT cascade to child
      destroyEntity(world, parent1);

      // Child survives (was reparented before deletion)
      assert.ok(isEntityAlive(world, child));
      assert.ok(hasComponent(world, child, pair(ChildOf, parent2)));
    });

    it("cascades correctly from new parent after reparenting", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfCascade", {
        exclusive: true,
        onDeleteTarget: "delete",
      });
      const parent1 = createEntity(world);
      const parent2 = createEntity(world);
      const child = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent1));
      addComponent(world, child, pair(ChildOf, parent2));

      // Destroy new parent - should cascade to child
      destroyEntity(world, parent2);

      assert.strictEqual(isEntityAlive(world, child), false);
      assert.ok(isEntityAlive(world, parent1)); // Old parent unaffected
    });
  });

  describe("Delete Policies", () => {
    it("default policy removes pairs but keeps subjects alive", () => {
      const world = createWorld();
      const HasTag = defineRelation("HasTagDefault"); // No onDeleteTarget = "remove"
      const entity = createEntity(world);
      const tag1 = createEntity(world);
      const tag2 = createEntity(world);
      const tag3 = createEntity(world);

      addComponent(world, entity, pair(HasTag, tag1));
      addComponent(world, entity, pair(HasTag, tag2));
      addComponent(world, entity, pair(HasTag, tag3));

      destroyEntity(world, tag2);

      // Entity keeps remaining tags
      assert.ok(hasComponent(world, entity, pair(HasTag, tag1)));
      assert.strictEqual(hasComponent(world, entity, pair(HasTag, tag2)), false);
      assert.ok(hasComponent(world, entity, pair(HasTag, tag3)));

      // Entity survives
      assert.ok(isEntityAlive(world, entity));
    });

    it("delete policy destroys subjects when target destroyed", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfDelete", { onDeleteTarget: "delete" });
      const parent = createEntity(world);
      const child = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent));

      destroyEntity(world, parent);

      // Child destroyed via cascade
      assert.strictEqual(isEntityAlive(world, child), false);
    });

    it("cascades through deep hierarchy", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfDeep", { onDeleteTarget: "delete" });

      // Build: scene -> player -> weapon -> enchantment
      const scene = createEntity(world);
      const player = createEntity(world);
      const weapon = createEntity(world);
      const enchantment = createEntity(world);

      addComponent(world, player, pair(ChildOf, scene));
      addComponent(world, weapon, pair(ChildOf, player));
      addComponent(world, enchantment, pair(ChildOf, weapon));

      destroyEntity(world, scene);

      // Entire chain destroyed via depth-first cascade
      assert.strictEqual(isEntityAlive(world, scene), false);
      assert.strictEqual(isEntityAlive(world, player), false);
      assert.strictEqual(isEntityAlive(world, weapon), false);
      assert.strictEqual(isEntityAlive(world, enchantment), false);
    });

    it("cascade wins over remove when both policies target same subject", () => {
      const world = createWorld();
      const OwnedBy = defineRelation("OwnedByMixed", { onDeleteTarget: "delete" });
      const EquippedTo = defineRelation("EquippedToMixed", { onDeleteTarget: "remove" });
      const player = createEntity(world);
      const sword = createEntity(world);

      // Sword has two relations to player with different policies
      addComponent(world, sword, pair(OwnedBy, player));
      addComponent(world, sword, pair(EquippedTo, player));

      destroyEntity(world, player);

      // Sword destroyed because OwnedBy has cascade policy
      assert.strictEqual(isEntityAlive(world, sword), false);
    });

    it("deleting one child does not affect siblings", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfSibling", { onDeleteTarget: "delete" });
      const parent = createEntity(world);
      const child1 = createEntity(world);
      const child2 = createEntity(world);
      const child3 = createEntity(world);

      addComponent(world, child1, pair(ChildOf, parent));
      addComponent(world, child2, pair(ChildOf, parent));
      addComponent(world, child3, pair(ChildOf, parent));

      // Direct deletion of child2 (not via cascade)
      destroyEntity(world, child2);

      // Siblings unaffected
      assert.ok(isEntityAlive(world, child1));
      assert.strictEqual(isEntityAlive(world, child2), false);
      assert.ok(isEntityAlive(world, child3));
      assert.ok(isEntityAlive(world, parent));
    });

    it("parent cascade destroys all remaining children", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfAll", { onDeleteTarget: "delete" });
      const parent = createEntity(world);
      const child1 = createEntity(world);
      const child2 = createEntity(world);

      addComponent(world, child1, pair(ChildOf, parent));
      addComponent(world, child2, pair(ChildOf, parent));

      // Direct deletion triggers sibling cascade from parent
      destroyEntity(world, child1);
      assert.ok(isEntityAlive(world, child2)); // Sibling survives direct delete

      destroyEntity(world, parent);

      // All remaining children cascade deleted
      assert.strictEqual(isEntityAlive(world, child2), false);
    });

    it("remove policy cleans up multi-generation without cascade", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfSkip", { onDeleteTarget: "remove" });

      // Three generations with skip-level reference
      const grandparent = createEntity(world);
      const parent = createEntity(world);
      const child = createEntity(world);

      addComponent(world, parent, pair(ChildOf, grandparent));
      addComponent(world, child, pair(ChildOf, parent));
      addComponent(world, child, pair(ChildOf, grandparent)); // Skip-level

      destroyEntity(world, grandparent);

      // Pairs removed but entities survive
      assert.strictEqual(hasComponent(world, parent, pair(ChildOf, grandparent)), false);
      assert.strictEqual(hasComponent(world, child, pair(ChildOf, grandparent)), false);
      assert.ok(hasComponent(world, child, pair(ChildOf, parent))); // Still has this one
      assert.ok(isEntityAlive(world, parent));
      assert.ok(isEntityAlive(world, child));
    });

    it("breaks cycles with mutual destruction pact", () => {
      const world = createWorld();
      const DestroysWith = defineRelation("DestroysWith", { onDeleteTarget: "delete" });

      // Mutual destruction: A -> B and B -> A
      const entityA = createEntity(world);
      const entityB = createEntity(world);

      addComponent(world, entityA, pair(DestroysWith, entityB));
      addComponent(world, entityB, pair(DestroysWith, entityA));

      // Should not infinite loop - meta.destroying guard breaks cycle
      assert.doesNotThrow(() => {
        destroyEntity(world, entityA);
      });

      // Both destroyed
      assert.strictEqual(isEntityAlive(world, entityA), false);
      assert.strictEqual(isEntityAlive(world, entityB), false);
    });

    it("handles three-way cycle without infinite recursion", () => {
      const world = createWorld();
      const DestroysWith = defineRelation("DestroysWith3", { onDeleteTarget: "delete" });

      // Cycle: A -> B -> C -> A
      const entityA = createEntity(world);
      const entityB = createEntity(world);
      const entityC = createEntity(world);

      addComponent(world, entityA, pair(DestroysWith, entityB));
      addComponent(world, entityB, pair(DestroysWith, entityC));
      addComponent(world, entityC, pair(DestroysWith, entityA));

      assert.doesNotThrow(() => {
        destroyEntity(world, entityA);
      });

      assert.strictEqual(isEntityAlive(world, entityA), false);
      assert.strictEqual(isEntityAlive(world, entityB), false);
      assert.strictEqual(isEntityAlive(world, entityC), false);
    });

    it("handles diamond convergence correctly", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfDiamond", {
        exclusive: false,
        onDeleteTarget: "delete",
      });

      // Diamond: root -> [left, right] -> bottom
      const root = createEntity(world);
      const left = createEntity(world);
      const right = createEntity(world);
      const bottom = createEntity(world);

      addComponent(world, left, pair(ChildOf, root));
      addComponent(world, right, pair(ChildOf, root));
      addComponent(world, bottom, pair(ChildOf, left));
      addComponent(world, bottom, pair(ChildOf, right)); // Multiple parents

      destroyEntity(world, root);

      // All four destroyed without double-free
      assert.strictEqual(isEntityAlive(world, root), false);
      assert.strictEqual(isEntityAlive(world, left), false);
      assert.strictEqual(isEntityAlive(world, right), false);
      assert.strictEqual(isEntityAlive(world, bottom), false);
    });

    it("cascade from one parent destroys multi-parent child", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfMultiParent", {
        exclusive: false,
        onDeleteTarget: "delete",
      });

      const parent1 = createEntity(world);
      const parent2 = createEntity(world);
      const child = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent1));
      addComponent(world, child, pair(ChildOf, parent2));

      // Delete one parent
      destroyEntity(world, parent1);

      // Child destroyed (cascade always deletes, regardless of other parents)
      assert.strictEqual(isEntityAlive(world, child), false);
      // Other parent survives
      assert.ok(isEntityAlive(world, parent2));
    });

    it("cross-relation cascade independence", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfCross", { onDeleteTarget: "delete" });
      const ManagedBy = defineRelation("ManagedByCross", { onDeleteTarget: "delete" });

      // player belongs to team1 hierarchy AND is managed by team2
      const team1 = createEntity(world);
      const team2 = createEntity(world);
      const player = createEntity(world);

      addComponent(world, player, pair(ChildOf, team1));
      addComponent(world, player, pair(ManagedBy, team2));

      destroyEntity(world, team1);

      // player destroyed via ChildOf cascade
      assert.strictEqual(isEntityAlive(world, player), false);
      // team2 survives (was target, not subject)
      assert.ok(isEntityAlive(world, team2));
    });

    it("complex graph with mixed relations and policies", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfComplex", { onDeleteTarget: "delete" });
      const OwnedBy = defineRelation("OwnedByComplex", { onDeleteTarget: "delete" });
      const Targets = defineRelation("TargetsComplex", { onDeleteTarget: "remove" });

      // scene -> player -> weapon (ChildOf + OwnedBy)
      // scene -> enemy -> projectile
      // player targets enemy
      const scene = createEntity(world);
      const player = createEntity(world);
      const enemy = createEntity(world);
      const weapon = createEntity(world);
      const projectile = createEntity(world);

      addComponent(world, player, pair(ChildOf, scene));
      addComponent(world, enemy, pair(ChildOf, scene));
      addComponent(world, weapon, pair(ChildOf, player));
      addComponent(world, weapon, pair(OwnedBy, player));
      addComponent(world, player, pair(Targets, enemy));
      addComponent(world, projectile, pair(ChildOf, enemy));

      destroyEntity(world, scene);

      // Entire graph destroyed
      assert.strictEqual(isEntityAlive(world, scene), false);
      assert.strictEqual(isEntityAlive(world, player), false);
      assert.strictEqual(isEntityAlive(world, enemy), false);
      assert.strictEqual(isEntityAlive(world, weapon), false);
      assert.strictEqual(isEntityAlive(world, projectile), false);
    });
  });

  describe("Complex Graph Scenarios", () => {
    it("handles direct and indirect reference with duplicate prevention", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfDirectIndirect", {
        exclusive: false,
        onDeleteTarget: "delete",
      });

      // grandparent -> parent -> child
      // grandparent -> child (direct skip-level reference)
      const grandparent = createEntity(world);
      const parent = createEntity(world);
      const child = createEntity(world);

      addComponent(world, parent, pair(ChildOf, grandparent));
      addComponent(world, child, pair(ChildOf, grandparent)); // Direct
      addComponent(world, child, pair(ChildOf, parent)); // Indirect

      // Delete grandparent - child appears in cascade set twice (via both paths)
      destroyEntity(world, grandparent);

      // All destroyed without double-free errors
      assert.strictEqual(isEntityAlive(world, grandparent), false);
      assert.strictEqual(isEntityAlive(world, parent), false);
      assert.strictEqual(isEntityAlive(world, child), false);
    });

    it("handles multi-relation to same ancestors with different policies", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfOrg", {
        exclusive: false,
        onDeleteTarget: "delete",
      });
      const ManagedBy = defineRelation("ManagedByOrg", {
        exclusive: false,
        onDeleteTarget: "delete",
      });
      const ReportsTo = defineRelation("ReportsToOrg", {
        exclusive: false,
        onDeleteTarget: "remove",
      });

      // Complex org structure:
      // - ceo
      // - manager (ChildOf ceo, ManagedBy ceo)
      // - worker (ChildOf manager, ManagedBy ceo, ReportsTo manager, ReportsTo ceo)
      const ceo = createEntity(world);
      const manager = createEntity(world);
      const worker = createEntity(world);

      addComponent(world, manager, pair(ChildOf, ceo));
      addComponent(world, manager, pair(ManagedBy, ceo));
      addComponent(world, worker, pair(ChildOf, manager));
      addComponent(world, worker, pair(ManagedBy, ceo));
      addComponent(world, worker, pair(ReportsTo, manager));
      addComponent(world, worker, pair(ReportsTo, ceo));

      destroyEntity(world, ceo);

      // Manager cascade via ChildOf and ManagedBy
      // Worker cascade via ManagedBy (direct) and ChildOf (via manager)
      // ReportsTo pairs removed during destruction
      assert.strictEqual(isEntityAlive(world, ceo), false);
      assert.strictEqual(isEntityAlive(world, manager), false);
      assert.strictEqual(isEntityAlive(world, worker), false);
    });

    it("handles wide fan-in structure with many entities", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfWide", {
        exclusive: false,
        onDeleteTarget: "delete",
      });

      const root = createEntity(world);
      const children = [createEntity(world), createEntity(world), createEntity(world)];
      const grandchildren: EntityId[] = [];

      // Each child is child of root
      for (const child of children) {
        addComponent(world, child, pair(ChildOf, root));
      }

      // 6 grandchildren, each is child of ALL three children (fan-in)
      for (let i = 0; i < 6; i++) {
        const grandchild = createEntity(world);
        grandchildren.push(grandchild);
        for (const child of children) {
          addComponent(world, grandchild, pair(ChildOf, child));
        }
      }

      // Verify setup
      assert.strictEqual(
        getRelationTargets(world, grandchildren[0]!, ChildOf).length,
        3,
        "Each grandchild should have 3 parents"
      );

      // Delete root - should cascade correctly despite fan-in duplicates
      destroyEntity(world, root);

      // Root and all children destroyed
      assert.strictEqual(isEntityAlive(world, root), false);
      for (const child of children) {
        assert.strictEqual(isEntityAlive(world, child), false);
      }

      // All grandchildren destroyed
      for (const grandchild of grandchildren) {
        assert.strictEqual(isEntityAlive(world, grandchild), false);
      }
    });

    it("handles entity with cascade and remove relations to different targets", () => {
      const world = createWorld();
      const OwnedBy = defineRelation("OwnedByMix", { onDeleteTarget: "delete" });
      const ReferencedBy = defineRelation("ReferencedByMix", { onDeleteTarget: "remove" });

      const owner = createEntity(world);
      const reference = createEntity(world);
      const item = createEntity(world);

      addComponent(world, item, pair(OwnedBy, owner));
      addComponent(world, item, pair(ReferencedBy, reference));

      // Destroy reference first - item survives (remove policy)
      destroyEntity(world, reference);
      assert.ok(isEntityAlive(world, item));
      assert.strictEqual(hasComponent(world, item, pair(ReferencedBy, reference)), false);
      assert.ok(hasComponent(world, item, pair(OwnedBy, owner)));

      // Destroy owner - item dies (cascade policy)
      destroyEntity(world, owner);
      assert.strictEqual(isEntityAlive(world, item), false);
    });

    it("handles mixed exclusive and non-exclusive in same graph", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfMixedEx", {
        exclusive: true,
        onDeleteTarget: "delete",
      });
      const TaggedWith = defineRelation("TaggedWithMixedEx", {
        exclusive: false,
        onDeleteTarget: "remove",
      });

      const root = createEntity(world);
      const middle = createEntity(world);
      const leaf = createEntity(world);
      const tag1 = createEntity(world);
      const tag2 = createEntity(world);

      // Exclusive hierarchy
      addComponent(world, middle, pair(ChildOf, root));
      addComponent(world, leaf, pair(ChildOf, middle));

      // Non-exclusive tags
      addComponent(world, leaf, pair(TaggedWith, tag1));
      addComponent(world, leaf, pair(TaggedWith, tag2));

      // Delete tag1 - leaf survives
      destroyEntity(world, tag1);
      assert.ok(isEntityAlive(world, leaf));
      assert.ok(hasComponent(world, leaf, pair(TaggedWith, tag2)));

      // Delete root - cascade destroys hierarchy
      destroyEntity(world, root);
      assert.strictEqual(isEntityAlive(world, middle), false);
      assert.strictEqual(isEntityAlive(world, leaf), false);

      // Tags survive (were targets, not subjects)
      assert.ok(isEntityAlive(world, tag2));
    });

    it("handles deep chain with mixed policies at different levels", () => {
      const world = createWorld();
      const Level1 = defineRelation("Level1Deep", { onDeleteTarget: "delete" });
      const Level2 = defineRelation("Level2Deep", { onDeleteTarget: "remove" });
      const Level3 = defineRelation("Level3Deep", { onDeleteTarget: "delete" });

      const root = createEntity(world);
      const a = createEntity(world);
      const b = createEntity(world);
      const c = createEntity(world);

      addComponent(world, a, pair(Level1, root)); // cascade
      addComponent(world, b, pair(Level2, a)); // remove
      addComponent(world, c, pair(Level3, b)); // cascade

      destroyEntity(world, root);

      // a destroyed (cascade from root)
      assert.strictEqual(isEntityAlive(world, a), false);
      // b survives (Level2 is remove policy)
      assert.ok(isEntityAlive(world, b));
      assert.strictEqual(hasComponent(world, b, pair(Level2, a)), false);
      // c survives (b wasn't deleted)
      assert.ok(isEntityAlive(world, c));
      assert.ok(hasComponent(world, c, pair(Level3, b)));
    });

    it("handles entity destroying itself via relation (self-reference)", () => {
      const world = createWorld();
      const Destroys = defineRelation("DestroysSelf", { onDeleteTarget: "delete" });

      const entity = createEntity(world);
      // Entity has cascade relation to itself
      addComponent(world, entity, pair(Destroys, entity));

      // Should handle gracefully via guards
      assert.doesNotThrow(() => {
        destroyEntity(world, entity);
      });

      assert.strictEqual(isEntityAlive(world, entity), false);
    });
  });
});
