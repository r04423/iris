import assert from "node:assert";
import { describe, it } from "node:test";
import { createAndRegisterArchetype } from "./archetype.js";
import { addComponent, getComponentValue, removeComponent, setComponentValue } from "./component.js";
import type { EntityId } from "./encoding.js";
import { createEntity, destroyEntity, isEntityAlive } from "./entity.js";
import { IrisInvalidArgument, IrisInvalidState, IrisLimitExceeded } from "./error.js";
import { hashFilterTerms } from "./filters.js";
import type { OrModifier } from "./query.js";
import {
  added,
  cacheQuery,
  changed,
  collectEntities,
  ensureQuery,
  hashQuery,
  not,
  or,
  queryColumns,
  queryEntities,
  queryFirstEntity,
} from "./query.js";
import { defineComponent, defineRelation, defineTag, Wildcard } from "./registry.js";
import { pair } from "./relation.js";
import { addSystem, defineSystem, runOnce } from "./scheduler.js";
import { Type } from "./schema.js";
import { createWorld, resetWorld } from "./world.js";

const FactoryResetQueryTag = defineTag("FactoryResetQueryTag");

describe("Query", () => {
  describe("Query Hashing", () => {
    const empty: EntityId[] = [];

    it("creates consistent hash for same query metadata", () => {
      const include = [1, 5] as EntityId[];
      const exclude = [7] as EntityId[];

      const hash1 = hashQuery(include, exclude, empty, empty);
      const hash2 = hashQuery(include, exclude, empty, empty);

      assert.strictEqual(hash1, hash2);
      assert.strictEqual(hash1, "+1:5|-7|~+|~>");
    });

    it("creates different hashes for different include arrays", () => {
      const hash1 = hashQuery([1] as EntityId[], empty, empty, empty);
      const hash2 = hashQuery([5] as EntityId[], empty, empty, empty);

      assert.strictEqual(hash1, "+1|-|~+|~>");
      assert.strictEqual(hash2, "+5|-|~+|~>");
    });

    it("creates different hashes for different exclude arrays", () => {
      const hash1 = hashQuery([1] as EntityId[], [3] as EntityId[], empty, empty);
      const hash2 = hashQuery([1] as EntityId[], [5] as EntityId[], empty, empty);

      assert.strictEqual(hash1, "+1|-3|~+|~>");
      assert.strictEqual(hash2, "+1|-5|~+|~>");
    });

    it("sorts arrays for consistent hashing", () => {
      const hash1 = hashQuery([1, 5, 3] as EntityId[], empty, empty, empty);
      const hash2 = hashQuery([5, 1, 3] as EntityId[], empty, empty, empty);
      const hash3 = hashQuery([3, 5, 1] as EntityId[], empty, empty, empty);

      assert.strictEqual(hash1, "+1:3:5|-|~+|~>");
      assert.strictEqual(hash1, hash2);
      assert.strictEqual(hash2, hash3);
    });

    it("produces empty hash sections for empty arrays", () => {
      const hash = hashQuery(empty, empty, empty, empty);

      assert.strictEqual(hash, "+|-|~+|~>");
    });

    it("stores query in registry with correct hash", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const query = ensureQuery(world, [Position]);
      const queryId = hashQuery([Position], empty, empty, empty);

      assert.strictEqual(world.queries.byId.get(queryId), query.meta);
    });

    it("includes change modifier values in hash format", () => {
      const hash = hashQuery([1] as EntityId[], [2] as EntityId[], [3] as EntityId[], [4] as EntityId[]);

      // Format: +include|-exclude|~+added|~>changed
      assert.strictEqual(hash, "+1|-2|~+3|~>4");
    });

    it("creates different hashes for different added arrays", () => {
      const hash1 = hashQuery([1] as EntityId[], empty, [3] as EntityId[], empty);
      const hash2 = hashQuery([1] as EntityId[], empty, [5] as EntityId[], empty);

      assert.strictEqual(hash1, "+1|-|~+3|~>");
      assert.strictEqual(hash2, "+1|-|~+5|~>");
    });

    it("creates different hashes for different changed arrays", () => {
      const hash1 = hashQuery([1] as EntityId[], empty, empty, [3] as EntityId[]);
      const hash2 = hashQuery([1] as EntityId[], empty, empty, [5] as EntityId[]);

      assert.strictEqual(hash1, "+1|-|~+|~>3");
      assert.strictEqual(hash2, "+1|-|~+|~>5");
    });

    it("sorts change modifier arrays for consistent hashing", () => {
      const hash1 = hashQuery([1] as EntityId[], empty, [3, 5, 7] as EntityId[], [2, 4] as EntityId[]);
      const hash2 = hashQuery([1] as EntityId[], empty, [7, 3, 5] as EntityId[], [4, 2] as EntityId[]);

      assert.strictEqual(hash1, "+1|-|~+3:5:7|~>2:4");
      assert.strictEqual(hash1, hash2);
    });

    it("differentiates queries with same components but different modifier types", () => {
      const component = 10 as EntityId;

      const hashAdded = hashQuery(empty, empty, [component], empty);
      const hashChanged = hashQuery(empty, empty, empty, [component]);

      assert.strictEqual(hashAdded, "+|-|~+10|~>");
      assert.strictEqual(hashChanged, "+|-|~+|~>10");
    });

    it("stores query with change modifiers in registry with correct hash", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Health = createEntity(world);

      const query = ensureQuery(world, [Position, added(Health)]);
      const queryId = hashQuery([Position], empty, [Health], empty);

      assert.strictEqual(world.queries.byId.get(queryId), query.meta);
    });

    it("caches queries with identical change modifiers", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Health = createEntity(world);

      const query1 = ensureQuery(world, [Position, added(Health), changed(Position)]);
      const query2 = ensureQuery(world, [Position, added(Health), changed(Position)]);

      assert.strictEqual(query1.meta, query2.meta);
      assert.strictEqual(world.queries.byId.size, 1);
    });

    it("creates separate queries for different change modifier combinations", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Health = createEntity(world);

      const query1 = ensureQuery(world, [Position, added(Health)]);
      const query2 = ensureQuery(world, [Position, changed(Health)]);

      assert.notStrictEqual(query1.meta, query2.meta);
      assert.strictEqual(world.queries.byId.size, 2);
    });
  });

  describe("Query Iteration", () => {
    it("fetches entities in single archetype", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const entity1 = createEntity(world);
      const entity2 = createEntity(world);
      const entity3 = createEntity(world);

      addComponent(world, entity1, Position);
      addComponent(world, entity2, Position);
      addComponent(world, entity3, Position);

      const entities = collectEntities(world, [Position]);

      assert.strictEqual(entities.length, 3);
      assert.ok(entities.some((e) => e === entity1));
      assert.ok(entities.some((e) => e === entity2));
      assert.ok(entities.some((e) => e === entity3));
    });

    it("fetches entities across multiple archetypes", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      // Archetype 1: Position only
      const entity1 = createEntity(world);
      addComponent(world, entity1, Position);

      // Archetype 2: Position + Velocity
      const entity2 = createEntity(world);
      addComponent(world, entity2, Position);
      addComponent(world, entity2, Velocity);

      // Fetch entities with Position (should match both archetypes)
      const entities = collectEntities(world, [Position]);

      assert.strictEqual(entities.length, 2);
      assert.ok(entities.some((e) => e === entity1));
      assert.ok(entities.some((e) => e === entity2));
    });

    it("iterates in reverse order (backward iteration)", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const entity1 = createEntity(world);
      const entity2 = createEntity(world);
      const entity3 = createEntity(world);

      addComponent(world, entity1, Position);
      addComponent(world, entity2, Position);
      addComponent(world, entity3, Position);

      const entities = collectEntities(world, [Position]);

      // Reverse order: last entity first
      assert.strictEqual(entities[0], entity3);
      assert.strictEqual(entities[1], entity2);
      assert.strictEqual(entities[2], entity1);
    });

    it("returns empty for non-matching query", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      const entity = createEntity(world);
      addComponent(world, entity, Position);

      // Fetch entities with Velocity (entity only has Position)
      const entities = collectEntities(world, [Velocity]);

      assert.strictEqual(entities.length, 0);
    });

    it("requires all selected types to match", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      addComponent(world, entity1, Position);
      addComponent(world, entity2, Position);
      addComponent(world, entity2, Velocity);

      // Fetch entities with both Position and Velocity
      const entities = collectEntities(world, [Position, Velocity]);

      // Only entity2 has both
      assert.strictEqual(entities.length, 1);
      assert.strictEqual(entities[0], entity2);
    });

    it("returns empty for empty world", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const entities = collectEntities(world, [Position]);

      assert.strictEqual(entities.length, 0);
    });

    it("throws for invalid component ID (fail-fast)", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const entity = createEntity(world);
      addComponent(world, entity, Position);

      // Raw number without type bits is invalid
      assert.throws(() => {
        collectEntities(world, [999 as EntityId]);
      }, IrisInvalidState);
    });
  });

  describe("Deletion Safety", () => {
    it("safely destroys all entities during iteration", () => {
      const world = createWorld();
      const Dead = createEntity(world);

      const entity1 = createEntity(world);
      const entity2 = createEntity(world);
      const entity3 = createEntity(world);

      addComponent(world, entity1, Dead);
      addComponent(world, entity2, Dead);
      addComponent(world, entity3, Dead);

      let destroyedCount = 0;

      queryEntities(world, [Dead], (entity) => {
        destroyEntity(world, entity);
        destroyedCount++;
      });

      // Verify all entities were visited
      assert.strictEqual(destroyedCount, 3);

      // Verify all entities are actually destroyed
      assert.strictEqual(isEntityAlive(world, entity1), false);
      assert.strictEqual(isEntityAlive(world, entity2), false);
      assert.strictEqual(isEntityAlive(world, entity3), false);
    });

    it("handles partial destruction during iteration", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const entity1 = createEntity(world);
      const entity2 = createEntity(world);
      const entity3 = createEntity(world);
      const entity4 = createEntity(world);

      addComponent(world, entity1, Position);
      addComponent(world, entity2, Position);
      addComponent(world, entity3, Position);
      addComponent(world, entity4, Position);

      const visited: number[] = [];

      queryEntities(world, [Position], (entity) => {
        visited.push(entity);
        // Destroy every other entity
        if (entity === entity4 || entity === entity2) {
          destroyEntity(world, entity);
        }
      });

      // All 4 entities should be visited (reverse order)
      assert.strictEqual(visited.length, 4);
      assert.deepStrictEqual(visited, [entity4, entity3, entity2, entity1]);

      // Verify destruction state
      assert.strictEqual(isEntityAlive(world, entity1), true, "entity1 should be alive");
      assert.strictEqual(isEntityAlive(world, entity2), false, "entity2 should be dead");
      assert.strictEqual(isEntityAlive(world, entity3), true, "entity3 should be alive");
      assert.strictEqual(isEntityAlive(world, entity4), false, "entity4 should be dead");
    });
  });

  describe("Filter Constraints", () => {
    it("fetches entities with multiple required components", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      addComponent(world, entity1, Position);
      addComponent(world, entity2, Position);
      addComponent(world, entity2, Velocity);

      // Fetch entities with both Position and Velocity
      const entities = collectEntities(world, [Position, Velocity]);

      assert.strictEqual(entities.length, 1);
      assert.strictEqual(entities[0], entity2);
    });

    it("fetches entities with exclude filter", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Health = createEntity(world);

      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      addComponent(world, entity1, Position);
      addComponent(world, entity2, Position);
      addComponent(world, entity2, Health);

      // Fetch Position, but exclude entities with Health
      const entities = collectEntities(world, [Position, not(Health)]);

      assert.strictEqual(entities.length, 1);
      assert.strictEqual(entities[0], entity1);
    });

    it("combines components and exclusions", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);
      const Health = createEntity(world);
      const Dead = createEntity(world);

      const entity1 = createEntity(world);
      const entity2 = createEntity(world);
      const entity3 = createEntity(world);
      const entity4 = createEntity(world);

      addComponent(world, entity1, Position);
      addComponent(world, entity1, Velocity);

      addComponent(world, entity2, Position);
      addComponent(world, entity2, Velocity);
      addComponent(world, entity2, Health);

      addComponent(world, entity3, Position); // Missing Velocity

      addComponent(world, entity4, Position);
      addComponent(world, entity4, Velocity);
      addComponent(world, entity4, Dead);

      // Fetch entities with Position and Velocity, but exclude those with Health or Dead
      const entities = collectEntities(world, [Position, Velocity, not(Health), not(Dead)]);

      assert.strictEqual(entities.length, 1);
      assert.strictEqual(entities[0], entity1);
    });

    it("returns no entities when a component is both included and excluded", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const entity = createEntity(world);
      addComponent(world, entity, Position);

      const query = ensureQuery(world, [Position, not(Position)]);

      // Contradictory branch is pruned, no dead filter is registered
      assert.strictEqual(query.meta.filters.length, 0);
      assert.strictEqual(world.filters.byId.size, 0);
      assert.deepStrictEqual(collectEntities(world, query), []);
    });
  });

  describe("Query with Filter Registry", () => {
    it("creates filter in registry on first query execution", () => {
      const world = createWorld();
      const Position = createEntity(world);

      createAndRegisterArchetype(world, [Position], new Map());

      const entities = collectEntities(world, [Position]);

      assert.strictEqual(entities.length, 0);

      const filterId = hashFilterTerms({ include: [Position], exclude: [] });
      const filter = world.filters.byId.get(filterId);

      assert.ok(filter);
      assert.strictEqual(filter.archetypes.length, 1);
    });

    it("reuses cached filter on subsequent query executions", () => {
      const world = createWorld();
      const Position = createEntity(world);

      createAndRegisterArchetype(world, [Position], new Map());

      collectEntities(world, [Position]);
      collectEntities(world, [Position]);

      assert.strictEqual(world.filters.byId.size, 1);
    });

    it("updates filter cache when archetype changes between queries", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      createAndRegisterArchetype(world, [Position], new Map());

      collectEntities(world, [Position]);

      const filterId = hashFilterTerms({ include: [Position], exclude: [] });
      const filter1 = world.filters.byId.get(filterId);

      assert.strictEqual(filter1?.archetypes.length, 1);

      createAndRegisterArchetype(world, [Position, Velocity], new Map());

      collectEntities(world, [Position]);

      const filter2 = world.filters.byId.get(filterId);

      assert.strictEqual(filter2?.archetypes.length, 2);
    });

    it("handles filter terms with exclusions", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);
      const Dead = createEntity(world);

      createAndRegisterArchetype(world, [Position, Velocity], new Map());
      createAndRegisterArchetype(world, [Position, Dead], new Map());

      const entities = collectEntities(world, [Position, not(Dead)]);

      assert.strictEqual(entities.length, 0);

      const filterId = hashFilterTerms({ include: [Position], exclude: [Dead] });
      const filter = world.filters.byId.get(filterId);

      assert.ok(filter);
      assert.strictEqual(filter.archetypes.length, 1);
    });

    it("creates separate filters for different query patterns", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      createAndRegisterArchetype(world, [Position], new Map());
      createAndRegisterArchetype(world, [Velocity], new Map());
      createAndRegisterArchetype(world, [Position, Velocity], new Map());

      collectEntities(world, [Position]);
      collectEntities(world, [Velocity]);
      collectEntities(world, [Position, Velocity]);

      assert.strictEqual(world.filters.byId.size, 3);
    });
  });

  describe("Query Registry Operations", () => {
    it("creates and caches query metadata", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const query = ensureQuery(world, [Position]);

      assert.ok(query);
      assert.deepStrictEqual(query.meta.include, [Position]);
      assert.deepStrictEqual(query.meta.exclude, []);
      assert.strictEqual(query.meta.filters.length, 1);
    });

    it("reuses cached query metadata on subsequent calls", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const query1 = ensureQuery(world, [Position]);
      const query2 = ensureQuery(world, [Position]);

      assert.strictEqual(query1.meta, query2.meta);
      assert.strictEqual(world.queries.byId.size, 1);
    });

    it("shares metadata across differently ordered queries", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      const velocityFirst = ensureQuery(world, [Velocity, Position]);
      const positionFirst = ensureQuery(world, [Position, Velocity]);

      assert.deepStrictEqual(positionFirst.requested, [Position, Velocity]);
      assert.deepStrictEqual(velocityFirst.requested, [Velocity, Position]);
      assert.strictEqual(positionFirst.meta, velocityFirst.meta);
      assert.strictEqual(world.queries.byId.size, 1);
    });

    it("rebuilds query metadata after reset", () => {
      const world = createWorld();
      const Position = defineComponent("QueryViewResetPosition", { x: Type.f32() });
      const Velocity = defineComponent("QueryViewResetVelocity", { vx: Type.f32() });
      const beforePositionFirst = ensureQuery(world, [Position, Velocity]);

      resetWorld(world);

      const afterPositionFirst = ensureQuery(world, [Position, Velocity]);
      const afterVelocityFirst = ensureQuery(world, [Velocity, Position]);

      assert.strictEqual(afterPositionFirst.meta, afterVelocityFirst.meta);
      assert.notStrictEqual(afterPositionFirst.meta, beforePositionFirst.meta);
      assert.strictEqual(world.queries.byId.size, 1);
    });

    it("creates separate queries for different component sets", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      const queryA = ensureQuery(world, [Position]);
      const queryB = ensureQuery(world, [Position, Velocity]);

      assert.notStrictEqual(queryA.meta, queryB.meta);
      assert.strictEqual(world.queries.byId.size, 2);
      assert.strictEqual(world.filters.byId.size, 2);
    });

    it("stores query in registry with correct hash", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const query = ensureQuery(world, [Position]);
      const queryId = hashQuery([Position], [], [], []);

      assert.strictEqual(world.queries.byId.get(queryId), query.meta);
    });

    it("throws when query has no components", () => {
      const world = createWorld();

      assert.throws(() => ensureQuery(world, []), IrisInvalidArgument);
    });
  });

  describe("Parametric Queries", () => {
    it("caches query metadata by argument tuple", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ParametricCacheChildOf");
      const parent = createEntity(world);
      const childrenOf = cacheQuery(world, (target: EntityId) => [pair(ChildOf, target)]);

      assert.strictEqual(childrenOf(parent), childrenOf(parent));
    });

    it("resolves different arguments independently", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ParametricArgumentsChildOf");
      const parentA = createEntity(world);
      const parentB = createEntity(world);
      const childA = createEntity(world);
      const childB = createEntity(world);
      addComponent(world, childA, pair(ChildOf, parentA));
      addComponent(world, childB, pair(ChildOf, parentB));
      const childrenOf = cacheQuery(world, (target: EntityId) => [pair(ChildOf, target)]);

      assert.deepStrictEqual(collectEntities(world, childrenOf(parentA)), [childA]);
      assert.deepStrictEqual(collectEntities(world, childrenOf(parentB)), [childB]);
      assert.notStrictEqual(childrenOf(parentA), childrenOf(parentB));
    });

    it("shares metadata with an equivalent static query", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ParametricSharingChildOf");
      const parent = createEntity(world);
      const childrenOf = cacheQuery(world, (target: EntityId) => [pair(ChildOf, target)]);

      assert.strictEqual(childrenOf(parent).meta, cacheQuery(world, [pair(ChildOf, parent)]).meta);
    });

    it("supports recursive traversal", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ParametricTraversalChildOf");
      const root = createEntity(world);
      const childA = createEntity(world);
      const childB = createEntity(world);
      const grandchild = createEntity(world);
      addComponent(world, childA, pair(ChildOf, root));
      addComponent(world, childB, pair(ChildOf, root));
      addComponent(world, grandchild, pair(ChildOf, childA));
      const childrenOf = cacheQuery(world, (target: EntityId) => [pair(ChildOf, target)]);
      const visited: EntityId[] = [];

      function visit(parent: EntityId): void {
        queryEntities(world, childrenOf(parent), (child) => {
          visited.push(child);
          visit(child);
        });
      }
      visit(root);

      assert.deepStrictEqual(new Set(visited), new Set([childA, childB, grandchild]));
    });

    it("supports multiple entity arguments", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ParametricMultiChildOf");
      const Likes = defineRelation("ParametricMultiLikes");
      const parent = createEntity(world);
      const friend = createEntity(world);
      const entity = createEntity(world);
      addComponent(world, entity, pair(ChildOf, parent));
      addComponent(world, entity, pair(Likes, friend));
      const relatedTo = cacheQuery(world, (parentId: EntityId, friendId: EntityId) => [
        pair(ChildOf, parentId),
        pair(Likes, friendId),
      ]);

      assert.deepStrictEqual(collectEntities(world, relatedTo(parent, friend)), [entity]);
    });

    it("keeps change detection independent when systems share cached metadata", async () => {
      const world = createWorld();
      const ChildOf = defineRelation("ParametricSystemChildOf");
      const parent = createEntity(world);
      const child = createEntity(world);
      addComponent(world, child, pair(ChildOf, parent));
      const queryMetas: object[] = [];
      const systemAResults: EntityId[] = [];
      const systemBResults: EntityId[] = [];

      addSystem(
        world,
        defineSystem("parametricSystemA", (systemWorld) => {
          const newChildrenOf = cacheQuery(systemWorld, (target: EntityId) => [added(pair(ChildOf, target))]);
          queryMetas.push(newChildrenOf(parent).meta);
          return () => {
            queryEntities(systemWorld, newChildrenOf(parent), (entity) => {
              systemAResults.push(entity);
            });
          };
        })
      );
      addSystem(
        world,
        defineSystem("parametricSystemB", (systemWorld) => {
          const newChildrenOf = cacheQuery(systemWorld, (target: EntityId) => [added(pair(ChildOf, target))]);
          queryMetas.push(newChildrenOf(parent).meta);
          return () => {
            queryEntities(systemWorld, newChildrenOf(parent), (entity) => {
              systemBResults.push(entity);
            });
          };
        })
      );

      await runOnce(world);

      assert.strictEqual(queryMetas[0], queryMetas[1]);
      assert.deepStrictEqual(systemAResults, [child]);
      assert.deepStrictEqual(systemBResults, [child]);
    });

    it("reacquires a factory's static query after world reset", async () => {
      const world = createWorld();
      const counts: number[] = [];

      addSystem(
        world,
        defineSystem("factoryResetQuery", (systemWorld) => {
          const query = cacheQuery(systemWorld, [FactoryResetQueryTag]);
          return () => {
            counts.push(collectEntities(systemWorld, query).length);
          };
        })
      );

      const oldEntity = createEntity(world);
      addComponent(world, oldEntity, FactoryResetQueryTag);
      await runOnce(world);

      resetWorld(world);
      await runOnce(world);

      const newEntity = createEntity(world);
      addComponent(world, newEntity, FactoryResetQueryTag);
      await runOnce(world);

      assert.deepStrictEqual(counts, [1, 0, 1]);
    });

    it("rebuilds a pre-existing getter after world reset", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ParametricResetChildOf");
      const childrenOf = cacheQuery(world, (target: EntityId) => [pair(ChildOf, target)]);
      const parent = createEntity(world);
      const beforeReset = childrenOf(parent);

      resetWorld(world);
      const newParent = createEntity(world);
      const child = createEntity(world);
      addComponent(world, child, pair(ChildOf, newParent));

      const afterReset = childrenOf(newParent);
      assert.notStrictEqual(afterReset, beforeReset);
      assert.deepStrictEqual(collectEntities(world, afterReset), [child]);
    });

    it("preserves pair order while sharing query metadata", () => {
      const world = createWorld();
      const Position = defineComponent("ParametricOrderPosition", { x: Type.f32() });
      const Weight = defineRelation("ParametricOrderWeight", { schema: { value: Type.f32() } });
      const target = createEntity(world);
      const entity = createEntity(world);
      const weighted = pair(Weight, target);
      addComponent(world, entity, Position, { x: 10 });
      addComponent(world, entity, weighted, { value: 20 });
      const positionFirst = cacheQuery(world, (targetId: EntityId) => [Position, pair(Weight, targetId)]);
      const weightFirst = cacheQuery(world, (targetId: EntityId) => [pair(Weight, targetId), Position]);

      const positionFirstQuery = positionFirst(target);
      const weightFirstQuery = weightFirst(target);

      assert.deepStrictEqual(weightFirstQuery.requested, [weighted, Position]);
      assert.strictEqual(positionFirstQuery.meta, weightFirstQuery.meta);
      assert.strictEqual(world.queries.byId.size, 1);

      queryColumns(world, weightFirstQuery, (_entities, [weight, position]) => {
        assert.strictEqual(weight.value[0], 20);
        assert.strictEqual(position.x[0], 10);
      });
    });

    it("validates builder terms on first lookup", () => {
      const world = createWorld();
      const Dead = defineTag("ParametricInvalidDead");
      const invalid = cacheQuery(world, (_target: EntityId) => [not(Dead)]);

      assert.throws(() => invalid(createEntity(world)), IrisInvalidArgument);
    });
  });

  describe("Query Persistence", () => {
    it("survives target entity destruction", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const entity = createEntity(world);
      addComponent(world, entity, Position);

      const query = ensureQuery(world, [Position]);

      assert.strictEqual(world.queries.byId.size, 1);

      destroyEntity(world, Position);

      // Query persists, it just has zero matching archetypes
      assert.strictEqual(world.queries.byId.size, 1);
      assert.strictEqual(query.meta.filters[0]!.archetypes.length, 0);
    });

    it("re-matches after new pair target established", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");

      const parent1 = createEntity(world);
      const child1 = createEntity(world);
      addComponent(world, child1, pair(ChildOf, parent1));

      const query = ensureQuery(world, [pair(ChildOf, parent1)]);

      // Verify child1 matches
      const initial = collectEntities(world, query);
      assert.strictEqual(initial.length, 1);
      assert.strictEqual(initial[0], child1);

      // Destroy child, entity removed, but query persists
      destroyEntity(world, child1);
      assert.strictEqual(world.queries.byId.size, 1);
      assert.strictEqual(collectEntities(world, query).length, 0);

      // Add new child with same pair, query re-matches
      const child2 = createEntity(world);
      addComponent(world, child2, pair(ChildOf, parent1));

      const results = collectEntities(world, query);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0], child2);
    });
  });

  describe("Filter Sharing Across Queries", () => {
    it("shares filter when same components and exclusions", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      const queryA = ensureQuery(world, [Position, Velocity]);
      const queryB = ensureQuery(world, [Position, Velocity]);

      assert.strictEqual(queryA.meta.filters[0], queryB.meta.filters[0]);
      assert.strictEqual(world.filters.byId.size, 1);
    });

    it("creates separate filters when components differ", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      const queryA = ensureQuery(world, [Position]);
      const queryB = ensureQuery(world, [Position, Velocity]);

      assert.notStrictEqual(queryA.meta.filters[0], queryB.meta.filters[0]);
      assert.strictEqual(world.filters.byId.size, 2);
    });

    it("shares filter when exclusions are duplicated", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Dead = createEntity(world);

      const queryA = ensureQuery(world, [Position, not(Dead), not(Dead)]);
      const queryB = ensureQuery(world, [Position, not(Dead)]);

      // Exclusions are deduped before filter creation, so the filter is shared
      assert.strictEqual(queryA.meta.filters[0], queryB.meta.filters[0]);
      assert.strictEqual(world.filters.byId.size, 1);
    });
  });

  describe("Or Queries", () => {
    it("matches entities with any alternative present", () => {
      const world = createWorld();
      const Velocity = createEntity(world);
      const Acceleration = createEntity(world);

      const mover = createEntity(world);
      const accelerator = createEntity(world);
      const bystander = createEntity(world);

      addComponent(world, mover, Velocity);
      addComponent(world, accelerator, Acceleration);

      const result = collectEntities(world, [or(Velocity, Acceleration)]);

      // Union of both alternatives; bystander (neither component) is absent
      assert.deepStrictEqual(result.toSorted(), [mover, accelerator].toSorted());
      assert.ok(isEntityAlive(world, bystander));
    });

    it("visits entity with multiple alternatives exactly once", () => {
      const world = createWorld();
      const Velocity = createEntity(world);
      const Acceleration = createEntity(world);

      const both = createEntity(world);
      addComponent(world, both, Velocity);
      addComponent(world, both, Acceleration);

      const result = collectEntities(world, [or(Velocity, Acceleration)]);

      assert.deepStrictEqual(result, [both]);
    });

    it("combines base components with or() alternatives", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);
      const Acceleration = createEntity(world);

      const positionOnly = createEntity(world);
      const positionMover = createEntity(world);

      addComponent(world, positionOnly, Position);
      addComponent(world, positionMover, Position);
      addComponent(world, positionMover, Velocity);
      addComponent(world, positionMover, Acceleration);

      const result = collectEntities(world, [Position, or(Velocity, Acceleration)]);

      assert.deepStrictEqual(result, [positionMover]);
    });

    it("combines or() with exclusion modifiers", () => {
      const world = createWorld();
      const Velocity = createEntity(world);
      const Acceleration = createEntity(world);
      const Dead = createEntity(world);

      const alive = createEntity(world);
      const dead = createEntity(world);

      addComponent(world, alive, Velocity);
      addComponent(world, dead, Acceleration);
      addComponent(world, dead, Dead);

      const result = collectEntities(world, [or(Velocity, Acceleration), not(Dead)]);

      assert.deepStrictEqual(result, [alive]);
    });

    it("shares query metadata regardless of alternative order", () => {
      const world = createWorld();
      const Velocity = createEntity(world);
      const Acceleration = createEntity(world);

      const queryA = ensureQuery(world, [or(Velocity, Acceleration)]);
      const queryB = ensureQuery(world, [or(Acceleration, Velocity)]);

      assert.strictEqual(queryA.meta, queryB.meta);
      assert.strictEqual(world.queries.byId.size, 1);
    });

    it("expands to disjoint filter branches", () => {
      const world = createWorld();
      const Velocity = createEntity(world);
      const Acceleration = createEntity(world);

      const query = ensureQuery(world, [or(Velocity, Acceleration)]);

      // Branch 1: [Velocity], Branch 2: [Acceleration, not(Velocity)]
      assert.strictEqual(query.meta.filters.length, 2);
      assert.deepStrictEqual(query.meta.filters[1]!.terms.exclude, [Velocity]);
    });

    it("matches archetypes created after query is cached", () => {
      const world = createWorld();
      const Velocity = createEntity(world);
      const Acceleration = createEntity(world);

      const query = ensureQuery(world, [or(Velocity, Acceleration)]);

      const late = createEntity(world);
      addComponent(world, late, Acceleration);

      assert.deepStrictEqual(collectEntities(world, query), [late]);
    });

    it("treats single-alternative or() as plain inclusion", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const plain = ensureQuery(world, [Position]);
      const orQuery = ensureQuery(world, [or(Position)]);

      // Same branch terms means the underlying filter is shared
      assert.strictEqual(orQuery.meta.filters.length, 1);
      assert.strictEqual(orQuery.meta.filters[0], plain.meta.filters[0]);
    });

    it("drops or() group already satisfied by base include", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      const query = ensureQuery(world, [Position, or(Position, Velocity)]);

      assert.strictEqual(query.meta.filters.length, 1);
    });

    it("prunes contradictory branches from excluded alternatives", () => {
      const world = createWorld();
      const Velocity = createEntity(world);
      const Acceleration = createEntity(world);

      const query = ensureQuery(world, [not(Velocity), or(Velocity, Acceleration)]);

      // Velocity branch contradicts not(Velocity), only Acceleration branch remains
      assert.strictEqual(query.meta.filters.length, 1);

      const entity = createEntity(world);
      addComponent(world, entity, Acceleration);

      assert.deepStrictEqual(collectEntities(world, query), [entity]);
    });

    it("returns no entities when all branches are contradictory", () => {
      const world = createWorld();
      const Velocity = createEntity(world);
      const Acceleration = createEntity(world);

      const entity = createEntity(world);
      addComponent(world, entity, Velocity);

      const query = ensureQuery(world, [not(Velocity), not(Acceleration), or(Velocity, Acceleration)]);

      assert.strictEqual(query.meta.filters.length, 0);
      assert.deepStrictEqual(collectEntities(world, query), []);
      assert.strictEqual(queryFirstEntity(world, query), undefined);
    });

    it("dedupes duplicate alternatives within a group", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      const queryA = ensureQuery(world, [or(Position, Position, Velocity)]);
      const queryB = ensureQuery(world, [or(Position, Velocity)]);

      assert.strictEqual(queryA.meta, queryB.meta);
      assert.strictEqual(queryA.meta.filters.length, 2);
    });

    it("drops or() group satisfied by a change detection component", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      // added(Position) guarantees Position on the filter, so the group is redundant
      const query = ensureQuery(world, [added(Position), or(Position, Velocity)]);

      assert.strictEqual(query.meta.filters.length, 1);
    });

    it("shares branch filters with equivalent conjunctive queries", () => {
      const world = createWorld();
      const Velocity = createEntity(world);
      const Acceleration = createEntity(world);

      // Surviving branch [Acceleration, not(Velocity)] dedupes the synthesized
      // exclusion against the user's not() and shares the conjunctive filter
      const orQuery = ensureQuery(world, [not(Velocity), or(Velocity, Acceleration)]);
      const plain = ensureQuery(world, [Acceleration, not(Velocity)]);

      assert.strictEqual(orQuery.meta.filters[0], plain.meta.filters[0]);
    });

    it("distinguishes queries with same alternatives grouped differently", () => {
      const world = createWorld();
      const A = createEntity(world);
      const B = createEntity(world);
      const C = createEntity(world);
      const D = createEntity(world);

      const queryA = ensureQuery(world, [or(A, B), or(C, D)]);
      const queryB = ensureQuery(world, [or(A, C), or(B, D)]);

      assert.notStrictEqual(queryA.meta, queryB.meta);
      assert.strictEqual(world.queries.byId.size, 2);
    });

    it("expands multiple or() groups as cartesian product", () => {
      const world = createWorld();
      const A = createEntity(world);
      const B = createEntity(world);
      const C = createEntity(world);
      const D = createEntity(world);

      const matching = createEntity(world);
      const partial = createEntity(world);

      addComponent(world, matching, A);
      addComponent(world, matching, D);
      addComponent(world, partial, A);

      const query = ensureQuery(world, [or(A, B), or(C, D)]);

      assert.strictEqual(query.meta.filters.length, 4);
      assert.deepStrictEqual(collectEntities(world, query), [matching]);
    });

    it("matches wildcard pair alternatives", () => {
      const world = createWorld();
      const ChildOf = defineRelation("OrQueryChildOf");
      const Orphan = createEntity(world);

      const parent = createEntity(world);
      const child = createEntity(world);
      const orphan = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent));
      addComponent(world, orphan, Orphan);

      const result = collectEntities(world, [or(pair(ChildOf, Wildcard), Orphan)]);

      assert.deepStrictEqual(result.toSorted(), [child, orphan].toSorted());
    });

    it("shares one change detection window across branches", async () => {
      const world = createWorld();
      const Health = createEntity(world);
      const Velocity = createEntity(world);
      const Acceleration = createEntity(world);

      const mover = createEntity(world);
      const accelerator = createEntity(world);

      addComponent(world, mover, Health);
      addComponent(world, mover, Velocity);
      addComponent(world, accelerator, Health);
      addComponent(world, accelerator, Acceleration);

      const seen: EntityId[] = [];

      addSystem(world, function orChangeChecker() {
        queryEntities(world, [added(Health), or(Velocity, Acceleration)], (entity) => {
          seen.push(entity);
        });
      });

      await runOnce(world);

      // Both branches report their addition despite sharing one lastTick
      assert.deepStrictEqual(seen.toSorted(), [mover, accelerator].toSorted());
    });

    it("provides aligned columns across branches in queryColumns", () => {
      const world = createWorld();
      const Position = defineComponent("or_qc_Position", { x: Type.f32() });
      const Velocity = createEntity(world);
      const Acceleration = createEntity(world);

      const mover = createEntity(world);
      const accelerator = createEntity(world);

      addComponent(world, mover, Position, { x: 1 });
      addComponent(world, mover, Velocity);
      addComponent(world, accelerator, Position, { x: 2 });
      addComponent(world, accelerator, Acceleration);

      let sum = 0;

      queryColumns(world, [Position, or(Velocity, Acceleration)], (entities, [pos]) => {
        for (let i = 0; i < entities.length; i++) {
          sum += pos.x[i]!;
        }
      });

      assert.strictEqual(sum, 3);
    });

    it("throws for empty or()", () => {
      assert.throws(() => or(), IrisInvalidArgument);
    });

    it("throws when branch expansion exceeds the limit", () => {
      const world = createWorld();
      const groups: OrModifier[] = [];

      // 6 groups of 2 alternatives = 64 branches > 32 limit
      for (let i = 0; i < 6; i++) {
        groups.push(or(createEntity(world), createEntity(world)));
      }

      assert.throws(() => ensureQuery(world, groups), IrisLimitExceeded);
    });
  });

  describe("queryFirstEntity", () => {
    it("returns first matching entity", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const entity1 = createEntity(world);
      const entity2 = createEntity(world);
      const entity3 = createEntity(world);

      addComponent(world, entity1, Position);
      addComponent(world, entity2, Position);
      addComponent(world, entity3, Position);

      const first = queryFirstEntity(world, [Position]);

      // Returns last added
      assert.strictEqual(first, entity3);
    });

    it("returns undefined when no entities match", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const first = queryFirstEntity(world, [Position]);

      assert.strictEqual(first, undefined);
    });

    it("works with multiple component requirements", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      addComponent(world, entity1, Position);
      addComponent(world, entity2, Position);
      addComponent(world, entity2, Velocity);

      const first = queryFirstEntity(world, [Position, Velocity]);

      assert.strictEqual(first, entity2);
    });

    it("works with exclusion modifiers", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Dead = createEntity(world);

      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      addComponent(world, entity1, Position);
      addComponent(world, entity2, Position);
      addComponent(world, entity1, Dead);

      const first = queryFirstEntity(world, [Position, not(Dead)]);

      assert.strictEqual(first, entity2);
    });

    it("works with change detection modifiers", async () => {
      const world = createWorld();
      const Health = createEntity(world);

      const entity = createEntity(world);
      addComponent(world, entity, Health);

      let first1: EntityId | undefined;
      let first2: EntityId | undefined;

      addSystem(world, function checker() {
        first1 = queryFirstEntity(world, [added(Health)]);
        // Second call should return undefined (lastTick updated)
        first2 = queryFirstEntity(world, [added(Health)]);
      });

      await runOnce(world);

      assert.strictEqual(first1, entity);
      assert.strictEqual(first2, undefined);
    });

    it("works with pair queries", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfFF");
      const parent = createEntity(world);
      const child = createEntity(world);

      addComponent(world, child, pair(ChildOf, parent));

      const first = queryFirstEntity(world, [pair(ChildOf, parent)]);

      assert.strictEqual(first, child);
    });
  });

  describe("queryEntities with Query", () => {
    it("fetches entities using query metadata", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      addComponent(world, entity1, Position);
      addComponent(world, entity2, Position);

      const query = ensureQuery(world, [Position]);
      const entities = collectEntities(world, query);

      assert.strictEqual(entities.length, 2);
      assert.ok(entities.some((e) => e === entity1));
      assert.ok(entities.some((e) => e === entity2));
    });

    it("returns empty for query with no matching entities", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const query = ensureQuery(world, [Position]);
      const entities = collectEntities(world, query);

      assert.strictEqual(entities.length, 0);
    });

    it("iterates in reverse order for deletion safety", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const entity1 = createEntity(world);
      const entity2 = createEntity(world);
      const entity3 = createEntity(world);

      addComponent(world, entity1, Position);
      addComponent(world, entity2, Position);
      addComponent(world, entity3, Position);

      const query = ensureQuery(world, [Position]);
      const entities = collectEntities(world, query);

      assert.strictEqual(entities[0], entity3);
      assert.strictEqual(entities[1], entity2);
      assert.strictEqual(entities[2], entity1);
    });
  });

  describe("Query with Pairs", () => {
    describe("Direct pair matching - pair(Relation, target)", () => {
      it("fetches entities with specific pair", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfFetchesEntitiesSpecificPair");
        const parent = createEntity(world);
        const child1 = createEntity(world);
        const child2 = createEntity(world);
        const other = createEntity(world);

        addComponent(world, child1, pair(ChildOf, parent));
        addComponent(world, child2, pair(ChildOf, parent));

        const entities = collectEntities(world, [pair(ChildOf, parent)]);

        assert.strictEqual(entities.length, 2);
        assert.ok(entities.some((e) => e === child1));
        assert.ok(entities.some((e) => e === child2));
        assert.ok(!entities.some((e) => e === other));
      });

      it("distinguishes between different targets", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfDistinguishesBetweenDifferentTargets");
        const parent1 = createEntity(world);
        const parent2 = createEntity(world);
        const child1 = createEntity(world);
        const child2 = createEntity(world);

        addComponent(world, child1, pair(ChildOf, parent1));
        addComponent(world, child2, pair(ChildOf, parent2));

        const childrenOfParent1 = collectEntities(world, [pair(ChildOf, parent1)]);
        const childrenOfParent2 = collectEntities(world, [pair(ChildOf, parent2)]);

        assert.strictEqual(childrenOfParent1.length, 1);
        assert.strictEqual(childrenOfParent1[0], child1);

        assert.strictEqual(childrenOfParent2.length, 1);
        assert.strictEqual(childrenOfParent2[0], child2);
      });

      it("returns empty for non-existent pair", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfReturnsEmptyNonExistentPair");
        const parent = createEntity(world);
        createEntity(world); // child with no pair

        const entities = collectEntities(world, [pair(ChildOf, parent)]);

        assert.strictEqual(entities.length, 0);
      });
    });

    describe("Any-target wildcard - pair(Relation, Wildcard)", () => {
      it("fetches all entities with any target for relation", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfFetchesAllEntitiesAnyTargetRelation");
        const parent1 = createEntity(world);
        const parent2 = createEntity(world);
        const child1 = createEntity(world);
        const child2 = createEntity(world);
        const child3 = createEntity(world);

        addComponent(world, child1, pair(ChildOf, parent1));
        addComponent(world, child2, pair(ChildOf, parent2));
        addComponent(world, child3, pair(ChildOf, parent1));

        // Query: entities with ANY ChildOf relation
        const entities = collectEntities(world, [pair(ChildOf, Wildcard)]);

        assert.strictEqual(entities.length, 3);
        assert.ok(entities.some((e) => e === child1));
        assert.ok(entities.some((e) => e === child2));
        assert.ok(entities.some((e) => e === child3));
      });

      it("excludes entities without the relation", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfExcludesEntitiesWithoutRelation");
        const Likes = defineRelation("Likes");
        const target = createEntity(world);
        const entity1 = createEntity(world);
        const entity2 = createEntity(world);

        addComponent(world, entity1, pair(ChildOf, target));
        addComponent(world, entity2, pair(Likes, target));

        const entities = collectEntities(world, [pair(ChildOf, Wildcard)]);

        assert.strictEqual(entities.length, 1);
        assert.strictEqual(entities[0], entity1);
      });

      it("works with entity having multiple targets for same relation", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfWorksEntityHavingMultipleTargetsRelation");
        const parent1 = createEntity(world);
        const parent2 = createEntity(world);
        const child = createEntity(world);

        addComponent(world, child, pair(ChildOf, parent1));
        addComponent(world, child, pair(ChildOf, parent2));

        const entities = collectEntities(world, [pair(ChildOf, Wildcard)]);

        assert.strictEqual(entities.length, 1);
        assert.strictEqual(entities[0], child);
      });
    });

    describe("Reverse lookup wildcard - pair(Wildcard, target)", () => {
      it("fetches all entities targeting specific entity", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfFetchesAllEntitiesTargetingSpecificEntity");
        const Likes = defineRelation("LikesFetchesAllEntitiesTargetingSpecificEntity");
        const target = createEntity(world);
        const entity1 = createEntity(world);
        const entity2 = createEntity(world);

        addComponent(world, entity1, pair(ChildOf, target));
        addComponent(world, entity2, pair(Likes, target));

        // Query: all entities targeting 'target' (any relation)
        const entities = collectEntities(world, [pair(Wildcard, target)]);

        assert.strictEqual(entities.length, 2);
        assert.ok(entities.some((e) => e === entity1));
        assert.ok(entities.some((e) => e === entity2));
      });

      it("excludes entities targeting different entity", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfExcludesEntitiesTargetingDifferentEntity");
        const target1 = createEntity(world);
        const target2 = createEntity(world);
        const entity1 = createEntity(world);
        const entity2 = createEntity(world);

        addComponent(world, entity1, pair(ChildOf, target1));
        addComponent(world, entity2, pair(ChildOf, target2));

        const entities = collectEntities(world, [pair(Wildcard, target1)]);

        assert.strictEqual(entities.length, 1);
        assert.strictEqual(entities[0], entity1);
      });

      it("works with tag targets", () => {
        const world = createWorld();
        const Has = defineRelation("Has");
        const Weapon = defineTag("Weapon");
        const entity1 = createEntity(world);
        createEntity(world); // entity without pair

        addComponent(world, entity1, pair(Has, Weapon));

        const entities = collectEntities(world, [pair(Wildcard, Weapon)]);

        assert.strictEqual(entities.length, 1);
        assert.strictEqual(entities[0], entity1);
      });
    });

    describe("Combined query patterns", () => {
      it("combines pair with regular component", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfCombinesPairRegularComponent");
        const Active = defineTag("Active");
        const parent = createEntity(world);
        const child1 = createEntity(world);
        const child2 = createEntity(world);

        addComponent(world, child1, pair(ChildOf, parent));
        addComponent(world, child1, Active);
        addComponent(world, child2, pair(ChildOf, parent));
        // child2 doesn't have Active

        // Query: children of parent that are also Active
        const entities = collectEntities(world, [pair(ChildOf, parent), Active]);

        assert.strictEqual(entities.length, 1);
        assert.strictEqual(entities[0], child1);
      });

      it("combines pair with exclusion", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfCombinesPairExclusion");
        const Dead = defineTag("Dead");
        const parent = createEntity(world);
        const child1 = createEntity(world);
        const child2 = createEntity(world);

        addComponent(world, child1, pair(ChildOf, parent));
        addComponent(world, child2, pair(ChildOf, parent));
        addComponent(world, child2, Dead);

        // Query: children of parent that are NOT dead
        const entities = collectEntities(world, [pair(ChildOf, parent), not(Dead)]);

        assert.strictEqual(entities.length, 1);
        assert.strictEqual(entities[0], child1);
      });

      it("combines multiple pairs", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfCombinesMultiplePairs");
        const Likes = defineRelation("LikesCombinesMultiplePairs");
        const parent = createEntity(world);
        const friend = createEntity(world);
        const entity1 = createEntity(world);
        const entity2 = createEntity(world);

        addComponent(world, entity1, pair(ChildOf, parent));
        addComponent(world, entity1, pair(Likes, friend));
        addComponent(world, entity2, pair(ChildOf, parent));
        // entity2 doesn't like friend

        // Query: children of parent who also like friend
        const entities = collectEntities(world, [pair(ChildOf, parent), pair(Likes, friend)]);

        assert.strictEqual(entities.length, 1);
        assert.strictEqual(entities[0], entity1);
      });

      it("combines wildcard pair with exclusion pair", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfCombinesWildcardPairExclusionPair");
        const parent1 = createEntity(world);
        const parent2 = createEntity(world);
        const child1 = createEntity(world);
        const child2 = createEntity(world);

        addComponent(world, child1, pair(ChildOf, parent1));
        addComponent(world, child2, pair(ChildOf, parent2));

        // Query: entities with any ChildOf, excluding those targeting parent2
        const entities = collectEntities(world, [pair(ChildOf, Wildcard), not(pair(ChildOf, parent2))]);

        assert.strictEqual(entities.length, 1);
        assert.strictEqual(entities[0], child1);
      });
    });

    describe("Query caching with pairs", () => {
      it("caches query with pair", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfCachesQueryPair");
        const parent = createEntity(world);

        const query1 = ensureQuery(world, [pair(ChildOf, parent)]);
        const query2 = ensureQuery(world, [pair(ChildOf, parent)]);

        assert.strictEqual(query1.meta, query2.meta);
        assert.strictEqual(world.queries.byId.size, 1);
      });

      it("creates separate queries for different pairs", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfCreatesSeparateQueriesDifferentPairs");
        const parent1 = createEntity(world);
        const parent2 = createEntity(world);

        const query1 = ensureQuery(world, [pair(ChildOf, parent1)]);
        const query2 = ensureQuery(world, [pair(ChildOf, parent2)]);

        assert.notStrictEqual(query1.meta, query2.meta);
        assert.strictEqual(world.queries.byId.size, 2);
      });

      it("creates separate queries for different wildcard patterns", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfCreatesSeparateQueriesDifferentWildcardPatterns");
        const parent = createEntity(world);

        const query1 = ensureQuery(world, [pair(ChildOf, Wildcard)]);
        const query2 = ensureQuery(world, [pair(Wildcard, parent)]);

        assert.notStrictEqual(query1.meta, query2.meta);
        assert.strictEqual(world.queries.byId.size, 2);
      });
    });

    describe("Dynamic pair queries", () => {
      it("updates results when pair added", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfUpdatesResultsPairAdded");
        const parent = createEntity(world);
        const child = createEntity(world);

        const entities1 = collectEntities(world, [pair(ChildOf, parent)]);
        assert.strictEqual(entities1.length, 0);

        addComponent(world, child, pair(ChildOf, parent));

        const entities2 = collectEntities(world, [pair(ChildOf, parent)]);
        assert.strictEqual(entities2.length, 1);
        assert.strictEqual(entities2[0], child);
      });

      it("updates results when pair removed", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfUpdatesResultsPairRemoved");
        const parent = createEntity(world);
        const child = createEntity(world);

        addComponent(world, child, pair(ChildOf, parent));

        const entities1 = collectEntities(world, [pair(ChildOf, parent)]);
        assert.strictEqual(entities1.length, 1);

        removeComponent(world, child, pair(ChildOf, parent));

        const entities2 = collectEntities(world, [pair(ChildOf, parent)]);
        assert.strictEqual(entities2.length, 0);
      });

      it("updates wildcard query when pair added/removed", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfUpdatesWildcardQueryPairAddedRemoved");
        const parent = createEntity(world);
        const child = createEntity(world);

        addComponent(world, child, pair(ChildOf, parent));

        const entities1 = collectEntities(world, [pair(ChildOf, Wildcard)]);
        assert.strictEqual(entities1.length, 1);

        removeComponent(world, child, pair(ChildOf, parent));

        const entities2 = collectEntities(world, [pair(ChildOf, Wildcard)]);
        assert.strictEqual(entities2.length, 0);
      });
    });

    describe("Practical use cases", () => {
      it("hierarchy: find all children of a parent", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfHierarchyFindAllChildrenParent");

        const root = createEntity(world);
        const branch1 = createEntity(world);
        const branch2 = createEntity(world);
        const leaf1 = createEntity(world);
        const leaf2 = createEntity(world);

        addComponent(world, branch1, pair(ChildOf, root));
        addComponent(world, branch2, pair(ChildOf, root));
        addComponent(world, leaf1, pair(ChildOf, branch1));
        addComponent(world, leaf2, pair(ChildOf, branch1));

        // Direct children of root
        const rootChildren = collectEntities(world, [pair(ChildOf, root)]);
        assert.strictEqual(rootChildren.length, 2);
        assert.ok(rootChildren.some((e) => e === branch1));
        assert.ok(rootChildren.some((e) => e === branch2));

        // Direct children of branch1
        const branch1Children = collectEntities(world, [pair(ChildOf, branch1)]);
        assert.strictEqual(branch1Children.length, 2);
        assert.ok(branch1Children.some((e) => e === leaf1));
        assert.ok(branch1Children.some((e) => e === leaf2));
      });

      it("inventory: find all containers", () => {
        const world = createWorld();
        const Contains = defineRelation("Contains");

        const chest = createEntity(world);
        const bag = createEntity(world);
        const sword = createEntity(world);
        const potion = createEntity(world);

        addComponent(world, chest, pair(Contains, sword));
        addComponent(world, chest, pair(Contains, potion));
        addComponent(world, bag, pair(Contains, potion));

        // Find all containers (entities with ANY Contains relation)
        const containers = collectEntities(world, [pair(Contains, Wildcard)]);

        assert.strictEqual(containers.length, 2);
        assert.ok(containers.some((e) => e === chest));
        assert.ok(containers.some((e) => e === bag));
      });

      it("reverse lookup: find all relationships to an entity", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfReverseLookupFindAllRelationshipsEntity");
        const Likes = defineRelation("LikesReverseLookupFindAllRelationshipsEntity");
        const Owns = defineRelation("Owns");

        const target = createEntity(world);
        const entity1 = createEntity(world);
        const entity2 = createEntity(world);
        const entity3 = createEntity(world);

        addComponent(world, entity1, pair(ChildOf, target));
        addComponent(world, entity2, pair(Likes, target));
        addComponent(world, entity3, pair(Owns, target));

        // Find all entities that have ANY relationship to target
        const related = collectEntities(world, [pair(Wildcard, target)]);

        assert.strictEqual(related.length, 3);
        assert.ok(related.some((e) => e === entity1));
        assert.ok(related.some((e) => e === entity2));
        assert.ok(related.some((e) => e === entity3));
      });
    });

    describe("Deletion safety with pairs", () => {
      it("safely destroys entities during pair query iteration", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfSafelyDestroysEntitiesDuringPairQueryIteration");
        const parent = createEntity(world);

        const child1 = createEntity(world);
        const child2 = createEntity(world);
        const child3 = createEntity(world);

        addComponent(world, child1, pair(ChildOf, parent));
        addComponent(world, child2, pair(ChildOf, parent));
        addComponent(world, child3, pair(ChildOf, parent));

        let destroyed = 0;
        queryEntities(world, [pair(ChildOf, parent)], (entity) => {
          destroyEntity(world, entity);
          destroyed++;
        });

        assert.strictEqual(destroyed, 3);
        assert.strictEqual(isEntityAlive(world, child1), false);
        assert.strictEqual(isEntityAlive(world, child2), false);
        assert.strictEqual(isEntityAlive(world, child3), false);
      });

      it("safely removes pairs during wildcard query iteration", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOfSafelyRemovesPairsDuringWildcardQueryIteration");
        const parent1 = createEntity(world);
        const parent2 = createEntity(world);

        const child1 = createEntity(world);
        const child2 = createEntity(world);

        addComponent(world, child1, pair(ChildOf, parent1));
        addComponent(world, child2, pair(ChildOf, parent2));

        let processed = 0;
        queryEntities(world, [pair(ChildOf, Wildcard)], (entity) => {
          removeComponent(world, entity, pair(ChildOf, entity === child1 ? parent1 : parent2));
          processed++;
        });

        assert.strictEqual(processed, 2);

        // Verify pairs were removed
        const remaining = collectEntities(world, [pair(ChildOf, Wildcard)]);
        assert.strictEqual(remaining.length, 0);
      });
    });
  });

  // ============================================================================
  // Change Detection Tests
  // ============================================================================

  describe("Change Detection - added()", () => {
    it("matches entities with component added since last query execution", async () => {
      const world = createWorld();
      const Health = createEntity(world);

      const entity1 = createEntity(world);
      addComponent(world, entity1, Health);

      let firstCount = 0;
      let secondCount = 0;

      addSystem(world, function checker() {
        // First query consumes the initial addition revision
        queryEntities(world, [added(Health)], () => {
          firstCount++;
        });
        // Second query has no intervening addition
        queryEntities(world, [added(Health)], () => {
          secondCount++;
        });
      });

      await runOnce(world);

      assert.strictEqual(firstCount, 1);
      assert.strictEqual(secondCount, 0);
    });

    it("matches newly added entities after tick advances", async () => {
      const world = createWorld();
      const Health = createEntity(world);

      const entity1 = createEntity(world);
      addComponent(world, entity1, Health);

      const results: EntityId[] = [];

      addSystem(world, function tracker() {
        queryEntities(world, [added(Health)], (e) => {
          results.push(e);
        });
      });

      // First frame: sees entity1
      await runOnce(world);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0], entity1);

      // Add new entity between frames
      const entity2 = createEntity(world);
      addComponent(world, entity2, Health);

      // Second frame: sees entity2 only
      await runOnce(world);
      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[1], entity2);
    });

    it("implicitly includes component in filter (entity must have component)", async () => {
      const world = createWorld();
      const Health = createEntity(world);

      const entity = createEntity(world);
      addComponent(world, entity, Health);
      removeComponent(world, entity, Health);

      let count = 0;

      addSystem(world, function checker() {
        queryEntities(world, [added(Health)], () => {
          count++;
        });
      });

      await runOnce(world);

      // Entity no longer has Health, even though it was added before removal
      assert.strictEqual(count, 0);
    });
  });

  describe("Change Detection - changed()", () => {
    it("matches entities with component changed since last query execution", async () => {
      const world = createWorld();
      const Position = defineComponent("PositionCD", { x: Type.f32(), y: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 0, y: 0 });

      const results: EntityId[] = [];

      addSystem(world, function tracker() {
        queryEntities(world, [changed(Position)], (e) => {
          results.push(e);
        });
      });

      // First frame: sees initial add
      await runOnce(world);
      assert.strictEqual(results.length, 1);

      // No change
      await runOnce(world);
      assert.strictEqual(results.length, 1);

      // Modify between frames
      setComponentValue(world, entity, Position, "x", 10);

      // Should see the change
      await runOnce(world);
      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[1], entity);
    });

    it("includes additions (add counts as change)", async () => {
      const world = createWorld();
      const Health = createEntity(world);

      const entity = createEntity(world);
      addComponent(world, entity, Health);

      let count = 0;

      addSystem(world, function checker() {
        queryEntities(world, [changed(Health)], () => {
          count++;
        });
      });

      await runOnce(world);

      // changed() should match because adding is a form of change
      assert.strictEqual(count, 1);
    });

    it("does not match without modification after lastTick update", async () => {
      const world = createWorld();
      const Position = defineComponent("PositionCD2", { x: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 0 });
      setComponentValue(world, entity, Position, "x", 5);

      const results: number[] = [];

      addSystem(world, function tracker() {
        let count = 0;
        queryEntities(world, [changed(Position)], () => {
          count++;
        });
        results.push(count);
      });

      await runOnce(world); // sees the change
      await runOnce(world); // no change since last query

      assert.deepStrictEqual(results, [1, 0]);
    });
  });

  describe("Pair Topology Change Detection", () => {
    it("changes but does not re-add a relation wildcard on exclusive replacement", async () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfExclusiveTopology", { exclusive: true });
      const parent1 = createEntity(world);
      const parent2 = createEntity(world);
      const child = createEntity(world);
      const relationWildcard = pair(ChildOf, Wildcard);
      const newPair = pair(ChildOf, parent2);
      const changedCounts: number[] = [];
      const addedCounts: number[] = [];
      const newPairAddedCounts: number[] = [];

      addComponent(world, child, pair(ChildOf, parent1));

      addSystem(world, function tracker() {
        changedCounts.push(collectEntities(world, [changed(relationWildcard)]).length);
        addedCounts.push(collectEntities(world, [added(relationWildcard)]).length);
        newPairAddedCounts.push(collectEntities(world, [added(newPair)]).length);
      });

      await runOnce(world);
      addComponent(world, child, newPair);
      await runOnce(world);

      assert.deepStrictEqual(changedCounts, [1, 1]);
      assert.deepStrictEqual(addedCounts, [1, 0]);
      assert.deepStrictEqual(newPairAddedCounts, [0, 1]);
    });

    it("changes but does not re-add a relation wildcard when adding another target", async () => {
      const world = createWorld();
      const Likes = defineRelation("LikesAdditionalTargetTopology");
      const target1 = createEntity(world);
      const target2 = createEntity(world);
      const entity = createEntity(world);
      const relationWildcard = pair(Likes, Wildcard);
      const changedCounts: number[] = [];
      const addedCounts: number[] = [];

      addComponent(world, entity, pair(Likes, target1));

      addSystem(world, function tracker() {
        changedCounts.push(collectEntities(world, [changed(relationWildcard)]).length);
        addedCounts.push(collectEntities(world, [added(relationWildcard)]).length);
      });

      await runOnce(world);
      addComponent(world, entity, pair(Likes, target2));
      await runOnce(world);

      assert.deepStrictEqual(changedCounts, [1, 1]);
      assert.deepStrictEqual(addedCounts, [1, 0]);
    });

    it("changes surviving relation and target wildcards on partial removal", async () => {
      const world = createWorld();
      const Likes = defineRelation("LikesPartialRemovalTopology");
      const Follows = defineRelation("FollowsPartialRemovalTopology");
      const target1 = createEntity(world);
      const target2 = createEntity(world);
      const entity = createEntity(world);
      const removedPair = pair(Likes, target1);
      const relationWildcard = pair(Likes, Wildcard);
      const targetWildcard = pair(Wildcard, target1);
      const relationChangedCounts: number[] = [];
      const relationAddedCounts: number[] = [];
      const targetChangedCounts: number[] = [];
      const targetAddedCounts: number[] = [];

      addComponent(world, entity, removedPair);
      addComponent(world, entity, pair(Likes, target2));
      addComponent(world, entity, pair(Follows, target1));

      addSystem(world, function tracker() {
        relationChangedCounts.push(collectEntities(world, [changed(relationWildcard)]).length);
        relationAddedCounts.push(collectEntities(world, [added(relationWildcard)]).length);
        targetChangedCounts.push(collectEntities(world, [changed(targetWildcard)]).length);
        targetAddedCounts.push(collectEntities(world, [added(targetWildcard)]).length);
      });

      await runOnce(world);
      removeComponent(world, entity, removedPair);
      await runOnce(world);

      assert.deepStrictEqual(relationChangedCounts, [1, 1]);
      assert.deepStrictEqual(relationAddedCounts, [1, 0]);
      assert.deepStrictEqual(targetChangedCounts, [1, 1]);
      assert.deepStrictEqual(targetAddedCounts, [1, 0]);
    });

    it("changes a surviving target wildcard on exclusive replacement", async () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfSharedOldTargetTopology", { exclusive: true });
      const Likes = defineRelation("LikesSharedOldTargetTopology");
      const parent1 = createEntity(world);
      const parent2 = createEntity(world);
      const child = createEntity(world);
      const targetWildcard = pair(Wildcard, parent1);
      const changedCounts: number[] = [];
      const addedCounts: number[] = [];

      addComponent(world, child, pair(ChildOf, parent1));
      addComponent(world, child, pair(Likes, parent1));

      addSystem(world, function tracker() {
        changedCounts.push(collectEntities(world, [changed(targetWildcard)]).length);
        addedCounts.push(collectEntities(world, [added(targetWildcard)]).length);
      });

      await runOnce(world);
      addComponent(world, child, pair(ChildOf, parent2));
      await runOnce(world);

      assert.deepStrictEqual(changedCounts, [1, 1]);
      assert.deepStrictEqual(addedCounts, [1, 0]);
    });

    it("does not treat pair payload changes as topology changes", async () => {
      const world = createWorld();
      const Scores = defineRelation("ScoresPayloadTopology", { schema: { value: Type.i32() } });
      const target = createEntity(world);
      const entity = createEntity(world);
      const score = pair(Scores, target);
      const relationWildcard = pair(Scores, Wildcard);
      const targetWildcard = pair(Wildcard, target);
      const pairChangedCounts: number[] = [];
      const relationChangedCounts: number[] = [];
      const targetChangedCounts: number[] = [];

      addComponent(world, entity, score, { value: 1 });

      addSystem(world, function tracker() {
        pairChangedCounts.push(collectEntities(world, [changed(score)]).length);
        relationChangedCounts.push(collectEntities(world, [changed(relationWildcard)]).length);
        targetChangedCounts.push(collectEntities(world, [changed(targetWildcard)]).length);
      });

      await runOnce(world);
      setComponentValue(world, entity, score, "value", 2);
      await runOnce(world);

      assert.deepStrictEqual(pairChangedCounts, [1, 1]);
      assert.deepStrictEqual(relationChangedCounts, [1, 0]);
      assert.deepStrictEqual(targetChangedCounts, [1, 0]);
    });
  });

  describe("Change Detection - Combined Modifiers", () => {
    it("combines added() with regular component requirements", async () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      addComponent(world, entity1, Position);
      addComponent(world, entity1, Velocity);
      addComponent(world, entity2, Position); // no Velocity

      let count = 0;
      let matched: EntityId | undefined;

      addSystem(world, function checker() {
        queryEntities(world, [added(Position), Velocity], (e) => {
          count++;
          matched = e;
        });
      });

      await runOnce(world);

      // Only entity1 has both Position (added) AND Velocity
      assert.strictEqual(count, 1);
      assert.strictEqual(matched, entity1);
    });

    it("combines changed() with not() exclusions", async () => {
      const world = createWorld();
      const Position = defineComponent("PositionCM", { x: Type.f32() });
      const Dead = createEntity(world);

      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      addComponent(world, entity1, Position, { x: 0 });
      addComponent(world, entity2, Position, { x: 0 });
      addComponent(world, entity2, Dead);

      const results: EntityId[][] = [];

      addSystem(world, function tracker() {
        const batch: EntityId[] = [];
        queryEntities(world, [changed(Position), not(Dead)], (e) => {
          batch.push(e);
        });
        results.push(batch);
      });

      // First frame: consume initial adds
      await runOnce(world);

      // Modify between frames
      setComponentValue(world, entity1, Position, "x", 1);
      setComponentValue(world, entity2, Position, "x", 2);

      // Second frame: entity2 is Dead, should be excluded
      await runOnce(world);

      assert.strictEqual(results[1]!.length, 1);
      assert.strictEqual(results[1]![0], entity1);
    });

    it("multiple change modifiers require ALL to match (AND semantics)", async () => {
      const world = createWorld();
      const Health = createEntity(world);
      const Mana = createEntity(world);

      const entity1 = createEntity(world);
      const entity2 = createEntity(world);
      const entity3 = createEntity(world);

      addComponent(world, entity1, Health);
      addComponent(world, entity1, Mana);
      addComponent(world, entity2, Health);
      addComponent(world, entity3, Mana);

      let count = 0;
      let matched: EntityId | undefined;

      addSystem(world, function checker() {
        queryEntities(world, [added(Health), added(Mana)], (e) => {
          count++;
          matched = e;
        });
      });

      await runOnce(world);

      // Only entity1 has BOTH Health AND Mana added
      assert.strictEqual(count, 1);
      assert.strictEqual(matched, entity1);
    });

    it("combines added() with pair relations", async () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOfCM");
      const Active = defineTag("ActiveCM");

      const parent = createEntity(world);
      const child1 = createEntity(world);
      const child2 = createEntity(world);

      addComponent(world, child1, pair(ChildOf, parent));
      addComponent(world, child1, Active);
      addComponent(world, child2, pair(ChildOf, parent));
      // child2 is not Active

      let count = 0;
      let matched: EntityId | undefined;

      addSystem(world, function checker() {
        queryEntities(world, [added(pair(ChildOf, parent)), Active], (e) => {
          count++;
          matched = e;
        });
      });

      await runOnce(world);

      // Find newly added children of parent that are also Active
      assert.strictEqual(count, 1);
      assert.strictEqual(matched, child1);
    });

    it("combines added() with changed() in single query", async () => {
      const world = createWorld();
      const Position = defineComponent("PositionComb", { x: Type.f32() });
      const NewState = createEntity(world);

      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 0 });

      const results: EntityId[][] = [];

      addSystem(world, function tracker() {
        const batch: EntityId[] = [];
        queryEntities(world, [added(NewState), changed(Position)], (e) => {
          batch.push(e);
        });
        results.push(batch);
      });

      // First frame: consume initial state (entity doesn't have NewState yet)
      await runOnce(world);

      // Both happen between frames: modify Position, add NewState
      setComponentValue(world, entity, Position, "x", 100);
      addComponent(world, entity, NewState);

      // Second frame: should see entity with both modifiers satisfied
      await runOnce(world);

      assert.strictEqual(results[1]!.length, 1);
      assert.strictEqual(results[1]![0], entity);
    });
  });

  describe("Change Detection - Query Revision Isolation", () => {
    it("shares a cursor across differently ordered queries", async () => {
      const world = createWorld();
      const Position = defineComponent("OrderedViewTickPosition", { x: Type.f32() });
      const Velocity = defineComponent("OrderedViewTickVelocity", { vx: Type.f32() });
      const Health = defineComponent("OrderedViewTickHealth", { value: Type.f32() });
      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 1 });
      addComponent(world, entity, Velocity, { vx: 2 });
      addComponent(world, entity, Health, { value: 3 });
      let positionFirstCount = 0;
      let velocityFirstCount = 0;

      addSystem(world, function orderedViewTickReader() {
        queryEntities(world, [Position, Velocity, added(Health)], () => {
          positionFirstCount++;
        });
        queryEntities(world, [Velocity, Position, added(Health)], () => {
          velocityFirstCount++;
        });
      });

      await runOnce(world);

      assert.strictEqual(positionFirstCount, 1);
      assert.strictEqual(velocityFirstCount, 0);
    });

    it("different queries maintain independent cursors in systems", async () => {
      const world = createWorld();
      const Health = createEntity(world);
      const Mana = createEntity(world);

      const entity = createEntity(world);
      addComponent(world, entity, Health);
      addComponent(world, entity, Mana);

      let healthCount1 = 0;
      let manaCount = 0;
      let healthCount2 = 0;

      addSystem(world, function checker() {
        // Query 1: added(Health)
        queryEntities(world, [added(Health)], () => {
          healthCount1++;
        });
        // Query 2: added(Mana) - independent, should still see the entity
        queryEntities(world, [added(Mana)], () => {
          manaCount++;
        });
        // Query 1 again: should be empty (its own cursor was updated)
        queryEntities(world, [added(Health)], () => {
          healthCount2++;
        });
      });

      await runOnce(world);

      assert.strictEqual(healthCount1, 1);
      assert.strictEqual(manaCount, 1);
      assert.strictEqual(healthCount2, 0);
    });
  });

  describe("Change Detection - Per-System Isolation", () => {
    it("same query in different systems maintains independent cursors", async () => {
      const world = createWorld();
      const Health = defineComponent("HealthPSI", { value: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Health, { value: 100 });

      const systemAResults: EntityId[] = [];
      const systemBResults: EntityId[] = [];

      // Both systems use the same query (added(Health))
      addSystem(world, function systemA() {
        queryEntities(world, [added(Health)], (e) => {
          systemAResults.push(e);
        });
      });

      addSystem(world, function systemB() {
        queryEntities(world, [added(Health)], (e) => {
          systemBResults.push(e);
        });
      });

      await runOnce(world);

      // Both systems should see the entity (independent cursor per system)
      assert.strictEqual(systemAResults.length, 1);
      assert.strictEqual(systemBResults.length, 1);
    });

    it("systems do not see changes from consumed revisions", async () => {
      const world = createWorld();
      const Health = defineComponent("HealthPSI2", { value: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Health, { value: 100 });

      // Track results across multiple schedule runs
      const results: number[] = [];

      addSystem(world, function tracker() {
        let count = 0;
        queryEntities(world, [added(Health)], () => {
          count++;
        });
        results.push(count);
      });

      await runOnce(world); // sees the initial addition
      await runOnce(world); // sees 0 (cursor updated)
      await runOnce(world); // sees 0

      assert.deepStrictEqual(results, [1, 0, 0]);
    });

    it("system sees changes made by an earlier system in the same frame", async () => {
      const world = createWorld();
      const Health = defineComponent("HealthSameTickVis", { value: Type.f32() });

      let systemBSawEntity = false;

      const systemB = defineSystem("systemB", (world) => () => {
        queryEntities(world, [added(Health)], () => {
          systemBSawEntity = true;
        });
      });

      const systemA = defineSystem("systemA", (world) => {
        return () => {
          const entity = createEntity(world);
          addComponent(world, entity, Health, { value: 50 });
        };
      });

      addSystem(world, systemB);
      addSystem(world, systemA, { before: systemB });

      await runOnce(world);

      // systemB runs after systemA and should see the added entity
      assert.strictEqual(systemBSawEntity, true);
    });

    it("outside-system change detection returns empty for added() and changed()", () => {
      const world = createWorld();
      const Health = defineComponent("HealthOutside", { value: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Health, { value: 100 });

      // added() outside system context returns empty
      const addedResults = collectEntities(world, [added(Health)]);
      assert.strictEqual(addedResults.length, 0);

      // changed() outside system context returns empty
      const changedResults = collectEntities(world, [changed(Health)]);
      assert.strictEqual(changedResults.length, 0);
    });

    it("changed() modifier respects per-system isolation", async () => {
      const world = createWorld();
      const Position = defineComponent("PositionPSI", { x: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 0 });

      const systemAResults: EntityId[] = [];
      const systemBResults: EntityId[] = [];

      const systemB = defineSystem("systemB", (world) => () => {
        queryEntities(world, [changed(Position)], (e) => {
          systemBResults.push(e);
        });
      });

      const systemA = defineSystem("systemA", (world) => {
        return () => {
          queryEntities(world, [changed(Position)], (e) => {
            systemAResults.push(e);
          });
          // Modify after querying
          setComponentValue(world, entity, Position, "x", systemAResults.length);
        };
      });

      addSystem(world, systemB);
      addSystem(world, systemA, { before: systemB });

      await runOnce(world);

      // systemA sees the initial add, then modifies Position in the revision
      // opened by its read. systemB independently sees that change.
      assert.strictEqual(systemAResults.length, 1);
      assert.strictEqual(systemBResults.length, 1);

      // Run again
      await runOnce(world);

      // systemA sees its post-read write and writes again. systemB sees the new
      // write through its independent cursor.
      assert.strictEqual(systemAResults.length, 2); // sees its post-read write
      assert.strictEqual(systemBResults.length, 2); // saw new change
    });
  });

  describe("Change Detection - Edge Cases", () => {
    it("advances revisions once for tracked APIs and never for ordinary APIs", async () => {
      const world = createWorld();
      const Health = createEntity(world);
      const entity = createEntity(world);
      addComponent(world, entity, Health);

      addSystem(world, function reader() {
        const initial = world.revision;
        queryEntities(world, [Health], () => {});
        queryFirstEntity(world, [Health]);
        collectEntities(world, [Health]);
        assert.strictEqual(world.revision, initial);

        queryEntities(world, [added(Health)], () => {});
        assert.strictEqual(world.revision, initial + 1);
        queryFirstEntity(world, [added(Health)]);
        assert.strictEqual(world.revision, initial + 2);
        collectEntities(world, [added(Health)]);
        assert.strictEqual(world.revision, initial + 3);
      });

      await runOnce(world);
    });

    it("detects revisions above the uint32 range", async () => {
      const world = createWorld();
      const Health = createEntity(world);
      world.revision = 2 ** 32 + 1;
      const entity = createEntity(world);
      addComponent(world, entity, Health);
      let seen = false;

      addSystem(world, function reader() {
        seen = queryFirstEntity(world, [added(Health)]) === entity;
      });

      await runOnce(world);
      assert.strictEqual(seen, true);
    });

    it("nested reads see callback writes and throwing reads consume their window", async () => {
      const world = createWorld();
      const Position = defineComponent("NestedRevisionPosition", { x: Type.f32() });
      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 0 });
      const counts: number[] = [];

      addSystem(world, function reader() {
        let outer = 0;
        let nested = 0;
        queryEntities(world, [changed(Position)], () => {
          outer++;
          setComponentValue(world, entity, Position, "x", 1);
          queryEntities(world, [changed(Position)], () => nested++);
        });
        counts.push(outer, nested, collectEntities(world, [changed(Position)]).length);
        setComponentValue(world, entity, Position, "x", 2);
        assert.throws(() =>
          queryEntities(world, [changed(Position)], () => {
            throw new Error("query callback");
          })
        );
        counts.push(collectEntities(world, [changed(Position)]).length);
      });

      await runOnce(world);
      assert.deepStrictEqual(counts, [1, 1, 0, 0]);
    });

    it("guards revision overflow without changing the query cursor", async () => {
      const world = createWorld();
      const Tracked = defineTag("QueryRevisionOverflow");
      const query = ensureQuery(world, [added(Tracked)]);
      addSystem(world, function reader() {
        const cursor = query.meta.lastRevision.get("reader");
        world.revision = Number.MAX_SAFE_INTEGER;
        assert.throws(() => collectEntities(world, query), IrisLimitExceeded);
        assert.strictEqual(world.revision, Number.MAX_SAFE_INTEGER);
        assert.strictEqual(query.meta.lastRevision.get("reader"), cursor);
      });
      await runOnce(world);
    });

    it("updates the revision cursor when callback returns false early", async () => {
      const world = createWorld();
      const Health = createEntity(world);

      const entity1 = createEntity(world);
      const entity2 = createEntity(world);
      const entity3 = createEntity(world);

      addComponent(world, entity1, Health);
      addComponent(world, entity2, Health);
      addComponent(world, entity3, Health);

      let breakCount = 0;
      let secondCount = 0;

      addSystem(world, function checker() {
        // Return false after first entity - should still consume the window
        queryEntities(world, [added(Health)], () => {
          breakCount++;
          return breakCount === 1 ? false : undefined;
        });

        // Second query should see nothing (cursor was updated despite early exit)
        queryEntities(world, [added(Health)], () => {
          secondCount++;
        });
      });

      await runOnce(world);

      assert.strictEqual(breakCount, 1);
      assert.strictEqual(secondCount, 0);
    });

    it("re-added component matches added()", async () => {
      const world = createWorld();
      const Shield = createEntity(world);

      const entity = createEntity(world);
      addComponent(world, entity, Shield);
      removeComponent(world, entity, Shield);
      addComponent(world, entity, Shield); // re-add in the same revision

      let count = 0;

      addSystem(world, function checker() {
        queryEntities(world, [added(Shield)], () => {
          count++;
        });
      });

      await runOnce(world);

      // added(Shield) should match - entity currently has Shield
      assert.strictEqual(count, 1);
    });

    it("destroyed entity does not appear in change detection queries", async () => {
      const world = createWorld();
      const Health = createEntity(world);

      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      addComponent(world, entity1, Health);
      addComponent(world, entity2, Health);

      destroyEntity(world, entity1);

      const results: EntityId[] = [];

      addSystem(world, function checker() {
        queryEntities(world, [added(Health)], (e) => {
          results.push(e);
        });
      });

      await runOnce(world);

      // Only entity2 should appear (entity1 destroyed)
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0], entity2);
    });
  });

  describe("Between-Tick Change Detection", () => {
    it("between-frame component addition visible to systems on next frame", async () => {
      const world = createWorld();
      const Health = defineComponent("HealthBetweenTick", { value: Type.f32() });

      const seen: EntityId[] = [];

      addSystem(world, function reader() {
        queryEntities(world, [added(Health)], (e) => {
          seen.push(e);
        });
      });

      // First frame: no entities with Health
      await runOnce(world);
      assert.strictEqual(seen.length, 0);

      // Add component between frames (at post-bump tick)
      const entity = createEntity(world);
      addComponent(world, entity, Health, { value: 100 });

      // Second frame: reader should see the between-frame addition
      await runOnce(world);
      assert.strictEqual(seen.length, 1);
      assert.strictEqual(seen[0], entity);
    });
  });

  describe("queryColumns", () => {
    describe("Basic Iteration", () => {
      it("iterates single archetype with correct column data", () => {
        const world = createWorld();
        const Position = defineComponent("qc_Position", {
          x: Type.f32<10 | 30>(),
          y: Type.f32(),
        });
        const e1 = createEntity(world);
        const e2 = createEntity(world);

        addComponent(world, e1, Position, { x: 10, y: 20 });
        addComponent(world, e2, Position, { x: 30, y: 40 });

        let callCount = 0;

        queryColumns(world, [Position], (entities, [pos]) => {
          callCount++;

          const x: 10 | 30 | undefined = pos.x[0];

          assert.strictEqual(entities.length, 2);
          assert.strictEqual(x, 10);
          assert.strictEqual(pos.y[0], 20);
          assert.strictEqual(pos.x[1], 30);
          assert.strictEqual(pos.y[1], 40);
        });

        queryEntities(world, [Position], (entity) => {
          const x: 10 | 30 = getComponentValue(world, entity, Position, "x");
          assert.ok(x === 10 || x === 30);
        });

        assert.strictEqual(callCount, 1);
      });
    });

    describe("Reference Columns", () => {
      it("types reference fields as arrays of stored references", () => {
        const world = createWorld();
        const Buckets = defineComponent("qc_ref_Buckets", {
          entities: Type.ref<EntityId[]>(),
          cache: Type.ref<Map<string, number>>(),
          weight: Type.f32(),
        });
        const entity = createEntity(world);
        const nearby = createEntity(world);

        addComponent(world, entity, Buckets, {
          entities: [nearby],
          cache: new Map([["score", 1]]),
          weight: 2,
        });

        queryColumns(world, [Buckets], (_entities, [buckets]) => {
          const entityLists: EntityId[][] = buckets.entities;
          const caches: Map<string, number>[] = buckets.cache;

          assert.deepStrictEqual(entityLists[0], [nearby]);
          assert.strictEqual(caches[0]?.get("score"), 1);
          assert.strictEqual(buckets.weight[0], 2);
        });
      });
    });

    describe("Multi-Archetype", () => {
      it("fires callback for each matching archetype", () => {
        const world = createWorld();
        const Position = defineComponent("qc_ma_Position", { x: Type.f32() });
        const Velocity = defineComponent("qc_ma_Velocity", { vx: Type.f32() });
        const e1 = createEntity(world);
        const e2 = createEntity(world);

        addComponent(world, e1, Position, { x: 1 });
        addComponent(world, e2, Position, { x: 2 });
        addComponent(world, e2, Velocity, { vx: 5 });

        let callCount = 0;
        const xValues: number[] = [];

        queryColumns(world, [Position], (entities, [pos]) => {
          callCount++;
          for (let i = 0; i < entities.length; i++) {
            xValues.push(pos.x[i]!);
          }
        });

        assert.strictEqual(callCount, 2);
        assert.deepStrictEqual(xValues.sort(), [1, 2]);
      });
    });

    describe("Tags", () => {
      it("uses tags for filtering but excludes them from column parameters", () => {
        const world = createWorld();
        const Position = defineComponent("qc_tag_Position", { x: Type.f32() });
        const IsEnemy = defineTag("qc_IsEnemy");
        const e1 = createEntity(world);
        const e2 = createEntity(world);

        addComponent(world, e1, Position, { x: 1 });
        addComponent(world, e1, IsEnemy);
        addComponent(world, e2, Position, { x: 2 });

        let matchedCount = 0;

        // Tag is used for filtering but does not produce a column parameter
        queryColumns(world, [Position, IsEnemy], (entities, [pos]) => {
          matchedCount += entities.length;
          assert.strictEqual(pos.x[0], 1);
        });

        assert.strictEqual(matchedCount, 1);
      });
    });

    describe("not() Modifier", () => {
      it("excludes matching archetypes", () => {
        const world = createWorld();
        const Position = defineComponent("qc_not_Position", { x: Type.f32() });
        const Dead = defineTag("qc_Dead");
        const e1 = createEntity(world);
        const e2 = createEntity(world);

        addComponent(world, e1, Position, { x: 1 });
        addComponent(world, e2, Position, { x: 2 });
        addComponent(world, e2, Dead);

        const xValues: number[] = [];

        queryColumns(world, [Position, not(Dead)], (entities, [pos]) => {
          for (let i = 0; i < entities.length; i++) {
            xValues.push(pos.x[i]!);
          }
        });

        assert.deepStrictEqual(xValues, [1]);
      });
    });

    describe("Modifier Restrictions", () => {
      it("rejects added() modifier", () => {
        const world = createWorld();
        const Position = defineComponent("qc_rej_Position", { x: Type.f32() });

        assert.throws(
          // @ts-expect-error added() is intentionally rejected by the type system
          () => queryColumns(world, [added(Position)], () => {}),
          (err: Error) => err.message.includes("queryColumns does not support added() or changed() modifiers")
        );
      });

      it("rejects changed() modifier", () => {
        const world = createWorld();
        const Position = defineComponent("qc_rejc_Position", { x: Type.f32() });

        assert.throws(
          // @ts-expect-error changed() is intentionally rejected by the type system
          () => queryColumns(world, [changed(Position)], () => {}),
          (err: Error) => err.message.includes("queryColumns does not support added() or changed() modifiers")
        );
      });
    });

    describe("Pairs", () => {
      it("provides column parameters for pairs with data", () => {
        const world = createWorld();
        const Position = defineComponent("qc_pair_Position", { x: Type.f32() });
        const Likes = defineRelation("qc_Likes", { schema: { strength: Type.f32() } });
        const target = createEntity(world);
        const e1 = createEntity(world);
        const likesTarget = pair(Likes, target);

        addComponent(world, e1, Position, { x: 10 });
        addComponent(world, e1, likesTarget, { strength: 0.8 });

        queryColumns(world, [Position, likesTarget], (entities, [pos, likes]) => {
          assert.strictEqual(entities.length, 1);
          assert.strictEqual(pos.x[0], 10);
          assert.ok(Math.abs(likes.strength[0]! - 0.8) < 0.001);
        });
      });

      it("excludes data-less pairs from column parameters", () => {
        const world = createWorld();
        const Position = defineComponent("qc_dlp_Position", { x: Type.f32() });
        const ChildOf = defineRelation("qc_ChildOf");
        const parent = createEntity(world);
        const child = createEntity(world);
        const childOfParent = pair(ChildOf, parent);

        addComponent(world, child, Position, { x: 5 });
        addComponent(world, child, childOfParent);

        // Data-less pair does not produce a column parameter — only pos
        queryColumns(world, [Position, childOfParent], (_entities, [pos]) => {
          assert.strictEqual(pos.x[0], 5);
        });
      });
    });

    describe("Pre-Cached Query", () => {
      it("works with pre-cached query from ensureQuery", () => {
        const world = createWorld();
        const Position = defineComponent("qc_cache_Position", { x: Type.f32() });
        const e1 = createEntity(world);

        addComponent(world, e1, Position, { x: 42 });

        const q = ensureQuery(world, [Position]);
        let called = false;

        queryColumns(world, q, (entities, [pos]) => {
          called = true;
          assert.strictEqual(entities.length, 1);
          assert.strictEqual(pos.x[0], 42);
        });

        assert.strictEqual(called, true);
      });

      it("preserves the requested column order for equivalent cached queries", () => {
        const world = createWorld();
        const Position = defineComponent("qc_cache_order_Position", { x: Type.f32() });
        const Velocity = defineComponent("qc_cache_order_Velocity", { vx: Type.f32() });
        const entity = createEntity(world);

        addComponent(world, entity, Position, { x: 10 });
        addComponent(world, entity, Velocity, { vx: 20 });

        cacheQuery(world, [Position, Velocity]);
        const velocityFirst = cacheQuery(world, [Velocity, Position]);

        queryColumns(world, velocityFirst, (_entities, [velocity, position]) => {
          assert.strictEqual(velocity.vx[0], 20);
          assert.strictEqual(position.x[0], 10);
        });
      });
    });

    describe("Early Exit", () => {
      it("stops iteration when callback returns false", () => {
        const world = createWorld();
        const Position = defineComponent("qc_exit_Position", { x: Type.f32() });
        const Velocity = defineComponent("qc_exit_Velocity", { vx: Type.f32() });
        const e1 = createEntity(world);
        const e2 = createEntity(world);

        addComponent(world, e1, Position, { x: 1 });
        addComponent(world, e2, Position, { x: 2 });
        addComponent(world, e2, Velocity, { vx: 5 });

        let callCount = 0;

        queryColumns(world, [Position], (_entities, _columns) => {
          callCount++;
          return false;
        });

        assert.strictEqual(callCount, 1);
      });
    });

    describe("Empty Archetypes", () => {
      it("skips archetypes with no entities", () => {
        const world = createWorld();
        const Position = defineComponent("qc_empty_Position", { x: Type.f32() });
        const Velocity = defineComponent("qc_empty_Velocity", { vx: Type.f32() });
        const e1 = createEntity(world);
        const e2 = createEntity(world);

        addComponent(world, e1, Position, { x: 1 });
        addComponent(world, e2, Position, { x: 2 });
        addComponent(world, e2, Velocity, { vx: 5 });

        destroyEntity(world, e2);

        let callCount = 0;

        queryColumns(world, [Position], (entities, _columns) => {
          callCount++;
          assert.ok(entities.length > 0);
        });

        assert.strictEqual(callCount, 1);
      });
    });

    describe("Mutation Safety", () => {
      it("supports safe backward iteration with entity destruction", () => {
        const world = createWorld();
        const Health = defineComponent("qc_mut_Health", { hp: Type.i32() });
        const entities: ReturnType<typeof createEntity>[] = [];

        for (let i = 0; i < 5; i++) {
          const e = createEntity(world);
          addComponent(world, e, Health, { hp: i < 3 ? 0 : 100 });
          entities.push(e);
        }

        queryColumns(world, [Health], (ents, [health]) => {
          for (let i = ents.length - 1; i >= 0; i--) {
            if (health.hp[i]! <= 0) {
              destroyEntity(world, ents[i]!);
            }
          }
        });

        let remaining = 0;
        queryColumns(world, [Health], (ents) => {
          remaining += ents.length;
        });

        assert.strictEqual(remaining, 2);
      });
    });

    describe("Vector Columns", () => {
      it("provides stride-based access through column references", () => {
        const world = createWorld();
        const Position = defineComponent("qc_vec_Position", { value: Type.f32(3) });
        const e1 = createEntity(world);
        const e2 = createEntity(world);

        addComponent(world, e1, Position, { value: [1, 2, 3] });
        addComponent(world, e2, Position, { value: [4, 5, 6] });

        queryColumns(world, [Position], (_entities, [pos]) => {
          assert.strictEqual(pos.value[0], 1);
          assert.strictEqual(pos.value[1], 2);
          assert.strictEqual(pos.value[2], 3);
          assert.strictEqual(pos.value[3], 4);
          assert.strictEqual(pos.value[4], 5);
          assert.strictEqual(pos.value[5], 6);
        });
      });
    });
  });
});
