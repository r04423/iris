import assert from "node:assert";
import { describe, it } from "node:test";
import { createAndRegisterArchetype } from "./archetype.js";
import { addComponent, removeComponent, setComponentValue } from "./component.js";
import type { EntityId } from "./encoding.js";
import { createEntity, destroyEntity, isEntityAlive } from "./entity.js";
import { hashFilterTerms } from "./filters.js";
import {
  added,
  changed,
  destroyQuery,
  ensureQuery,
  fetchEntities,
  fetchEntitiesWithQuery,
  fetchFirstEntity,
  hashQuery,
  not,
} from "./query.js";
import { defineComponent, defineRelation, defineTag, Wildcard } from "./registry.js";
import { pair } from "./relation.js";
import { addSystem, runOnce } from "./scheduler.js";
import { Type } from "./schema.js";
import { createWorld } from "./world.js";

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

      const query = ensureQuery(world, Position);
      const queryId = hashQuery([Position], empty, empty, empty);

      assert.strictEqual(world.queries.byId.get(queryId), query);
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

      const query = ensureQuery(world, Position, added(Health));
      const queryId = hashQuery([Position], empty, [Health], empty);

      assert.strictEqual(world.queries.byId.get(queryId), query);
    });

    it("caches queries with identical change modifiers", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Health = createEntity(world);

      const query1 = ensureQuery(world, Position, added(Health), changed(Position));
      const query2 = ensureQuery(world, Position, added(Health), changed(Position));

      assert.strictEqual(query1, query2);
      assert.strictEqual(world.queries.byId.size, 1);
    });

    it("creates separate queries for different change modifier combinations", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Health = createEntity(world);

      const query1 = ensureQuery(world, Position, added(Health));
      const query2 = ensureQuery(world, Position, changed(Health));

      assert.notStrictEqual(query1, query2);
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

      const entities = [...fetchEntities(world, Position)];

      assert.strictEqual(entities.length, 3);
      assert.ok(entities.includes(entity1));
      assert.ok(entities.includes(entity2));
      assert.ok(entities.includes(entity3));
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
      const entities = [...fetchEntities(world, Position)];

      assert.strictEqual(entities.length, 2);
      assert.ok(entities.includes(entity1));
      assert.ok(entities.includes(entity2));
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

      const entities = [...fetchEntities(world, Position)];

      // Reverse order: last entity first
      assert.strictEqual(entities[0], entity3);
      assert.strictEqual(entities[1], entity2);
      assert.strictEqual(entities[2], entity1);
    });

    it("returns empty iterator for non-matching query", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      const entity = createEntity(world);
      addComponent(world, entity, Position);

      // Fetch entities with Velocity (entity only has Position)
      const entities = [...fetchEntities(world, Velocity)];

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
      const entities = [...fetchEntities(world, Position, Velocity)];

      // Only entity2 has both
      assert.strictEqual(entities.length, 1);
      assert.strictEqual(entities[0], entity2);
    });

    it("returns empty iterator for empty world", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const entities = [...fetchEntities(world, Position)];

      assert.strictEqual(entities.length, 0);
    });

    it("throws for invalid component ID (fail-fast)", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const entity = createEntity(world);
      addComponent(world, entity, Position);

      // Raw number without type bits is invalid
      assert.throws(() => {
        [...fetchEntities(world, 999 as EntityId)];
      }, /Invalid entity type/);
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
      const entities = fetchEntities(world, Dead);

      for (const entity of entities) {
        destroyEntity(world, entity);
        destroyedCount++;
      }

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
      const entities = fetchEntities(world, Position);

      for (const entity of entities) {
        visited.push(entity);
        // Destroy every other entity
        if (entity === entity4 || entity === entity2) {
          destroyEntity(world, entity);
        }
      }

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
      const entities = [...fetchEntities(world, Position, Velocity)];

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
      const entities = [...fetchEntities(world, Position, not(Health))];

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
      const entities = [...fetchEntities(world, Position, Velocity, not(Health), not(Dead))];

      assert.strictEqual(entities.length, 1);
      assert.strictEqual(entities[0], entity1);
    });
  });

  describe("Query with Filter Registry", () => {
    it("creates filter in registry on first query execution", () => {
      const world = createWorld();
      const Position = createEntity(world);

      createAndRegisterArchetype(world, [Position], new Map());

      const entities = [...fetchEntities(world, Position)];

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

      [...fetchEntities(world, Position)];
      [...fetchEntities(world, Position)];

      assert.strictEqual(world.filters.byId.size, 1);
    });

    it("updates filter cache when archetype changes between queries", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      createAndRegisterArchetype(world, [Position], new Map());

      [...fetchEntities(world, Position)];

      const filterId = hashFilterTerms({ include: [Position], exclude: [] });
      const filter1 = world.filters.byId.get(filterId);

      assert.strictEqual(filter1?.archetypes.length, 1);

      createAndRegisterArchetype(world, [Position, Velocity], new Map());

      [...fetchEntities(world, Position)];

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

      const entities = [...fetchEntities(world, Position, not(Dead))];

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

      [...fetchEntities(world, Position)];
      [...fetchEntities(world, Velocity)];
      [...fetchEntities(world, Position, Velocity)];

      assert.strictEqual(world.filters.byId.size, 3);
    });
  });

  describe("Query Registry Operations", () => {
    it("creates and caches query metadata", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const query = ensureQuery(world, Position);

      assert.ok(query);
      assert.deepStrictEqual(query.include, [Position]);
      assert.deepStrictEqual(query.exclude, []);
      assert.ok(query.filter);
      assert.ok(query.onFilterDestroy);
    });

    it("reuses cached query on subsequent calls", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const query1 = ensureQuery(world, Position);
      const query2 = ensureQuery(world, Position);

      assert.strictEqual(query1, query2);
      assert.strictEqual(world.queries.byId.size, 1);
    });

    it("creates separate queries for different component sets", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      const queryA = ensureQuery(world, Position);
      const queryB = ensureQuery(world, Position, Velocity);

      assert.notStrictEqual(queryA, queryB);
      assert.strictEqual(world.queries.byId.size, 2);
      assert.strictEqual(world.filters.byId.size, 2);
    });

    it("stores query in registry with correct hash", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const query = ensureQuery(world, Position);
      const queryId = hashQuery([Position], [], [], []);

      assert.strictEqual(world.queries.byId.get(queryId), query);
    });

    it("throws when query has no components", () => {
      const world = createWorld();

      assert.throws(() => ensureQuery(world), /must include at least one component/);
    });
  });

  describe("Query Observer Registration", () => {
    it("registers observer callback for filter destruction", () => {
      const world = createWorld();
      const Position = createEntity(world);

      ensureQuery(world, Position);

      const callbacks = world.observers.filterDestroyed.callbacks;
      assert.strictEqual(callbacks.length, 1);
    });

    it("callback references correct filter", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const query = ensureQuery(world, Position);

      assert.strictEqual(query.onFilterDestroy.length, 1);
    });

    it("multiple queries register separate callbacks", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      ensureQuery(world, Position);
      ensureQuery(world, Velocity);

      const callbacks = world.observers.filterDestroyed.callbacks;
      assert.strictEqual(callbacks.length, 2);
    });
  });

  describe("Query Self-Cleanup", () => {
    it("removes query when filter is destroyed", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const entity = createEntity(world);
      addComponent(world, entity, Position);

      ensureQuery(world, Position);

      assert.strictEqual(world.queries.byId.size, 1);

      destroyEntity(world, Position);

      assert.strictEqual(world.queries.byId.size, 0);
    });

    it("unregisters callback during self-cleanup", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const entity = createEntity(world);
      addComponent(world, entity, Position);

      ensureQuery(world, Position);

      const callbacksBefore = world.observers.filterDestroyed.callbacks.length;

      destroyEntity(world, Position);

      const callbacksAfter = world.observers.filterDestroyed.callbacks.length;

      assert.strictEqual(callbacksBefore, 1);
      assert.strictEqual(callbacksAfter, 0);
    });

    it("only removes matching query on filter destruction", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      const entity1 = createEntity(world);
      addComponent(world, entity1, Position);

      const entity2 = createEntity(world);
      addComponent(world, entity2, Velocity);

      ensureQuery(world, Position);
      ensureQuery(world, Velocity);

      assert.strictEqual(world.queries.byId.size, 2);

      destroyEntity(world, Position);

      assert.strictEqual(world.queries.byId.size, 1);
    });
  });

  describe("Manual Query Destruction", () => {
    it("removes query from registry", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const query = ensureQuery(world, Position);

      assert.strictEqual(world.queries.byId.size, 1);

      destroyQuery(world, query);

      assert.strictEqual(world.queries.byId.size, 0);
    });

    it("unregisters observer callback", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const query = ensureQuery(world, Position);

      assert.strictEqual(world.observers.filterDestroyed.callbacks.length, 1);

      destroyQuery(world, query);

      assert.strictEqual(world.observers.filterDestroyed.callbacks.length, 0);
    });

    it("does not affect underlying filter", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const query = ensureQuery(world, Position);
      const filterId = hashFilterTerms({ include: [Position], exclude: [] });

      destroyQuery(world, query);

      assert.ok(world.filters.byId.get(filterId));
    });

    it("handles destruction of non-existent query gracefully", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const query = ensureQuery(world, Position);

      destroyQuery(world, query);
      destroyQuery(world, query);

      assert.strictEqual(world.queries.byId.size, 0);
    });
  });

  describe("Filter Sharing Across Queries", () => {
    it("shares filter when same components and exclusions", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      const queryA = ensureQuery(world, Position, Velocity);
      const queryB = ensureQuery(world, Position, Velocity);

      assert.strictEqual(queryA.filter, queryB.filter);
      assert.strictEqual(world.filters.byId.size, 1);
    });

    it("creates separate filters when components differ", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      const queryA = ensureQuery(world, Position);
      const queryB = ensureQuery(world, Position, Velocity);

      assert.notStrictEqual(queryA.filter, queryB.filter);
      assert.strictEqual(world.filters.byId.size, 2);
    });

    it("multiple queries referencing same filter stay valid after one query destroyed", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      const queryA = ensureQuery(world, Position, Velocity);
      const queryB = ensureQuery(world, Position, Velocity);

      destroyQuery(world, queryA);

      assert.ok(world.filters.byId.size > 0);
      assert.ok(queryB.filter);
    });
  });

  describe("fetchFirstEntity", () => {
    it("returns first matching entity", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const entity1 = createEntity(world);
      const entity2 = createEntity(world);
      const entity3 = createEntity(world);

      addComponent(world, entity1, Position);
      addComponent(world, entity2, Position);
      addComponent(world, entity3, Position);

      const first = fetchFirstEntity(world, Position);

      // Returns last added
      assert.strictEqual(first, entity3);
    });

    it("returns undefined when no entities match", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const first = fetchFirstEntity(world, Position);

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

      const first = fetchFirstEntity(world, Position, Velocity);

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

      const first = fetchFirstEntity(world, Position, not(Dead));

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
        first1 = fetchFirstEntity(world, added(Health));
        // Second call should return undefined (lastTick updated)
        first2 = fetchFirstEntity(world, added(Health));
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

      const first = fetchFirstEntity(world, pair(ChildOf, parent));

      assert.strictEqual(first, child);
    });
  });

  describe("fetchEntitiesWithQuery", () => {
    it("fetches entities using query metadata", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      addComponent(world, entity1, Position);
      addComponent(world, entity2, Position);

      const query = ensureQuery(world, Position);
      const entities = [...fetchEntitiesWithQuery(world, query)];

      assert.strictEqual(entities.length, 2);
      assert.ok(entities.includes(entity1));
      assert.ok(entities.includes(entity2));
    });

    it("returns empty iterator for query with no matching entities", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const query = ensureQuery(world, Position);
      const entities = [...fetchEntitiesWithQuery(world, query)];

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

      const query = ensureQuery(world, Position);
      const entities = [...fetchEntitiesWithQuery(world, query)];

      assert.strictEqual(entities[0], entity3);
      assert.strictEqual(entities[1], entity2);
      assert.strictEqual(entities[2], entity1);
    });
  });

  describe("Query with Pairs", () => {
    describe("Direct pair matching - pair(Relation, target)", () => {
      it("fetches entities with specific pair", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");
        const parent = createEntity(world);
        const child1 = createEntity(world);
        const child2 = createEntity(world);
        const other = createEntity(world);

        addComponent(world, child1, pair(ChildOf, parent));
        addComponent(world, child2, pair(ChildOf, parent));

        const entities = [...fetchEntities(world, pair(ChildOf, parent))];

        assert.strictEqual(entities.length, 2);
        assert.ok(entities.includes(child1));
        assert.ok(entities.includes(child2));
        assert.ok(!entities.includes(other));
      });

      it("distinguishes between different targets", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");
        const parent1 = createEntity(world);
        const parent2 = createEntity(world);
        const child1 = createEntity(world);
        const child2 = createEntity(world);

        addComponent(world, child1, pair(ChildOf, parent1));
        addComponent(world, child2, pair(ChildOf, parent2));

        const childrenOfParent1 = [...fetchEntities(world, pair(ChildOf, parent1))];
        const childrenOfParent2 = [...fetchEntities(world, pair(ChildOf, parent2))];

        assert.strictEqual(childrenOfParent1.length, 1);
        assert.strictEqual(childrenOfParent1[0], child1);

        assert.strictEqual(childrenOfParent2.length, 1);
        assert.strictEqual(childrenOfParent2[0], child2);
      });

      it("returns empty for non-existent pair", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");
        const parent = createEntity(world);
        createEntity(world); // child with no pair

        const entities = [...fetchEntities(world, pair(ChildOf, parent))];

        assert.strictEqual(entities.length, 0);
      });
    });

    describe("Any-target wildcard - pair(Relation, Wildcard)", () => {
      it("fetches all entities with any target for relation", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");
        const parent1 = createEntity(world);
        const parent2 = createEntity(world);
        const child1 = createEntity(world);
        const child2 = createEntity(world);
        const child3 = createEntity(world);

        addComponent(world, child1, pair(ChildOf, parent1));
        addComponent(world, child2, pair(ChildOf, parent2));
        addComponent(world, child3, pair(ChildOf, parent1));

        // Query: entities with ANY ChildOf relation
        const entities = [...fetchEntities(world, pair(ChildOf, Wildcard))];

        assert.strictEqual(entities.length, 3);
        assert.ok(entities.includes(child1));
        assert.ok(entities.includes(child2));
        assert.ok(entities.includes(child3));
      });

      it("excludes entities without the relation", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");
        const Likes = defineRelation("Likes");
        const target = createEntity(world);
        const entity1 = createEntity(world);
        const entity2 = createEntity(world);

        addComponent(world, entity1, pair(ChildOf, target));
        addComponent(world, entity2, pair(Likes, target));

        const entities = [...fetchEntities(world, pair(ChildOf, Wildcard))];

        assert.strictEqual(entities.length, 1);
        assert.strictEqual(entities[0], entity1);
      });

      it("works with entity having multiple targets for same relation", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");
        const parent1 = createEntity(world);
        const parent2 = createEntity(world);
        const child = createEntity(world);

        addComponent(world, child, pair(ChildOf, parent1));
        addComponent(world, child, pair(ChildOf, parent2));

        const entities = [...fetchEntities(world, pair(ChildOf, Wildcard))];

        assert.strictEqual(entities.length, 1);
        assert.strictEqual(entities[0], child);
      });
    });

    describe("Reverse lookup wildcard - pair(Wildcard, target)", () => {
      it("fetches all entities targeting specific entity", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");
        const Likes = defineRelation("Likes");
        const target = createEntity(world);
        const entity1 = createEntity(world);
        const entity2 = createEntity(world);

        addComponent(world, entity1, pair(ChildOf, target));
        addComponent(world, entity2, pair(Likes, target));

        // Query: all entities targeting 'target' (any relation)
        const entities = [...fetchEntities(world, pair(Wildcard, target))];

        assert.strictEqual(entities.length, 2);
        assert.ok(entities.includes(entity1));
        assert.ok(entities.includes(entity2));
      });

      it("excludes entities targeting different entity", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");
        const target1 = createEntity(world);
        const target2 = createEntity(world);
        const entity1 = createEntity(world);
        const entity2 = createEntity(world);

        addComponent(world, entity1, pair(ChildOf, target1));
        addComponent(world, entity2, pair(ChildOf, target2));

        const entities = [...fetchEntities(world, pair(Wildcard, target1))];

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

        const entities = [...fetchEntities(world, pair(Wildcard, Weapon))];

        assert.strictEqual(entities.length, 1);
        assert.strictEqual(entities[0], entity1);
      });
    });

    describe("Combined query patterns", () => {
      it("combines pair with regular component", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");
        const Active = defineTag("Active");
        const parent = createEntity(world);
        const child1 = createEntity(world);
        const child2 = createEntity(world);

        addComponent(world, child1, pair(ChildOf, parent));
        addComponent(world, child1, Active);
        addComponent(world, child2, pair(ChildOf, parent));
        // child2 doesn't have Active

        // Query: children of parent that are also Active
        const entities = [...fetchEntities(world, pair(ChildOf, parent), Active)];

        assert.strictEqual(entities.length, 1);
        assert.strictEqual(entities[0], child1);
      });

      it("combines pair with exclusion", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");
        const Dead = defineTag("Dead");
        const parent = createEntity(world);
        const child1 = createEntity(world);
        const child2 = createEntity(world);

        addComponent(world, child1, pair(ChildOf, parent));
        addComponent(world, child2, pair(ChildOf, parent));
        addComponent(world, child2, Dead);

        // Query: children of parent that are NOT dead
        const entities = [...fetchEntities(world, pair(ChildOf, parent), not(Dead))];

        assert.strictEqual(entities.length, 1);
        assert.strictEqual(entities[0], child1);
      });

      it("combines multiple pairs", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");
        const Likes = defineRelation("Likes");
        const parent = createEntity(world);
        const friend = createEntity(world);
        const entity1 = createEntity(world);
        const entity2 = createEntity(world);

        addComponent(world, entity1, pair(ChildOf, parent));
        addComponent(world, entity1, pair(Likes, friend));
        addComponent(world, entity2, pair(ChildOf, parent));
        // entity2 doesn't like friend

        // Query: children of parent who also like friend
        const entities = [...fetchEntities(world, pair(ChildOf, parent), pair(Likes, friend))];

        assert.strictEqual(entities.length, 1);
        assert.strictEqual(entities[0], entity1);
      });

      it("combines wildcard pair with exclusion pair", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");
        const parent1 = createEntity(world);
        const parent2 = createEntity(world);
        const child1 = createEntity(world);
        const child2 = createEntity(world);

        addComponent(world, child1, pair(ChildOf, parent1));
        addComponent(world, child2, pair(ChildOf, parent2));

        // Query: entities with any ChildOf, excluding those targeting parent2
        const entities = [...fetchEntities(world, pair(ChildOf, Wildcard), not(pair(ChildOf, parent2)))];

        assert.strictEqual(entities.length, 1);
        assert.strictEqual(entities[0], child1);
      });
    });

    describe("Query caching with pairs", () => {
      it("caches query with pair", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");
        const parent = createEntity(world);

        const query1 = ensureQuery(world, pair(ChildOf, parent));
        const query2 = ensureQuery(world, pair(ChildOf, parent));

        assert.strictEqual(query1, query2);
        assert.strictEqual(world.queries.byId.size, 1);
      });

      it("creates separate queries for different pairs", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");
        const parent1 = createEntity(world);
        const parent2 = createEntity(world);

        const query1 = ensureQuery(world, pair(ChildOf, parent1));
        const query2 = ensureQuery(world, pair(ChildOf, parent2));

        assert.notStrictEqual(query1, query2);
        assert.strictEqual(world.queries.byId.size, 2);
      });

      it("creates separate queries for different wildcard patterns", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");
        const parent = createEntity(world);

        const query1 = ensureQuery(world, pair(ChildOf, Wildcard));
        const query2 = ensureQuery(world, pair(Wildcard, parent));

        assert.notStrictEqual(query1, query2);
        assert.strictEqual(world.queries.byId.size, 2);
      });
    });

    describe("Dynamic pair queries", () => {
      it("updates results when pair added", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");
        const parent = createEntity(world);
        const child = createEntity(world);

        const entities1 = [...fetchEntities(world, pair(ChildOf, parent))];
        assert.strictEqual(entities1.length, 0);

        addComponent(world, child, pair(ChildOf, parent));

        const entities2 = [...fetchEntities(world, pair(ChildOf, parent))];
        assert.strictEqual(entities2.length, 1);
        assert.strictEqual(entities2[0], child);
      });

      it("updates results when pair removed", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");
        const parent = createEntity(world);
        const child = createEntity(world);

        addComponent(world, child, pair(ChildOf, parent));

        const entities1 = [...fetchEntities(world, pair(ChildOf, parent))];
        assert.strictEqual(entities1.length, 1);

        removeComponent(world, child, pair(ChildOf, parent));

        const entities2 = [...fetchEntities(world, pair(ChildOf, parent))];
        assert.strictEqual(entities2.length, 0);
      });

      it("updates wildcard query when pair added/removed", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");
        const parent = createEntity(world);
        const child = createEntity(world);

        addComponent(world, child, pair(ChildOf, parent));

        const entities1 = [...fetchEntities(world, pair(ChildOf, Wildcard))];
        assert.strictEqual(entities1.length, 1);

        removeComponent(world, child, pair(ChildOf, parent));

        const entities2 = [...fetchEntities(world, pair(ChildOf, Wildcard))];
        assert.strictEqual(entities2.length, 0);
      });
    });

    describe("Practical use cases", () => {
      it("hierarchy: find all children of a parent", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");

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
        const rootChildren = [...fetchEntities(world, pair(ChildOf, root))];
        assert.strictEqual(rootChildren.length, 2);
        assert.ok(rootChildren.includes(branch1));
        assert.ok(rootChildren.includes(branch2));

        // Direct children of branch1
        const branch1Children = [...fetchEntities(world, pair(ChildOf, branch1))];
        assert.strictEqual(branch1Children.length, 2);
        assert.ok(branch1Children.includes(leaf1));
        assert.ok(branch1Children.includes(leaf2));
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
        const containers = [...fetchEntities(world, pair(Contains, Wildcard))];

        assert.strictEqual(containers.length, 2);
        assert.ok(containers.includes(chest));
        assert.ok(containers.includes(bag));
      });

      it("reverse lookup: find all relationships to an entity", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");
        const Likes = defineRelation("Likes");
        const Owns = defineRelation("Owns");

        const target = createEntity(world);
        const entity1 = createEntity(world);
        const entity2 = createEntity(world);
        const entity3 = createEntity(world);

        addComponent(world, entity1, pair(ChildOf, target));
        addComponent(world, entity2, pair(Likes, target));
        addComponent(world, entity3, pair(Owns, target));

        // Find all entities that have ANY relationship to target
        const related = [...fetchEntities(world, pair(Wildcard, target))];

        assert.strictEqual(related.length, 3);
        assert.ok(related.includes(entity1));
        assert.ok(related.includes(entity2));
        assert.ok(related.includes(entity3));
      });
    });

    describe("Deletion safety with pairs", () => {
      it("safely destroys entities during pair query iteration", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");
        const parent = createEntity(world);

        const child1 = createEntity(world);
        const child2 = createEntity(world);
        const child3 = createEntity(world);

        addComponent(world, child1, pair(ChildOf, parent));
        addComponent(world, child2, pair(ChildOf, parent));
        addComponent(world, child3, pair(ChildOf, parent));

        let destroyed = 0;
        for (const entity of fetchEntities(world, pair(ChildOf, parent))) {
          destroyEntity(world, entity);
          destroyed++;
        }

        assert.strictEqual(destroyed, 3);
        assert.strictEqual(isEntityAlive(world, child1), false);
        assert.strictEqual(isEntityAlive(world, child2), false);
        assert.strictEqual(isEntityAlive(world, child3), false);
      });

      it("safely removes pairs during wildcard query iteration", () => {
        const world = createWorld();
        const ChildOf = defineRelation("ChildOf");
        const parent1 = createEntity(world);
        const parent2 = createEntity(world);

        const child1 = createEntity(world);
        const child2 = createEntity(world);

        addComponent(world, child1, pair(ChildOf, parent1));
        addComponent(world, child2, pair(ChildOf, parent2));

        let processed = 0;
        for (const entity of fetchEntities(world, pair(ChildOf, Wildcard))) {
          removeComponent(world, entity, pair(ChildOf, entity === child1 ? parent1 : parent2));
          processed++;
        }

        assert.strictEqual(processed, 2);

        // Verify pairs were removed
        const remaining = [...fetchEntities(world, pair(ChildOf, Wildcard))];
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
        // First query: entity1 was added at tick 1, lastTick is 0, should match
        for (const _ of fetchEntities(world, added(Health))) {
          firstCount++;
        }
        // Second query at same tick: lastTick updated, no match
        for (const _ of fetchEntities(world, added(Health))) {
          secondCount++;
        }
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
        for (const e of fetchEntities(world, added(Health))) {
          results.push(e);
        }
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
        for (const _ of fetchEntities(world, added(Health))) {
          count++;
        }
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
        for (const e of fetchEntities(world, changed(Position))) {
          results.push(e);
        }
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
        for (const _ of fetchEntities(world, changed(Health))) {
          count++;
        }
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
        for (const _ of fetchEntities(world, changed(Position))) {
          count++;
        }
        results.push(count);
      });

      await runOnce(world); // sees the change
      await runOnce(world); // no change since last query

      assert.deepStrictEqual(results, [1, 0]);
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
        for (const e of fetchEntities(world, added(Position), Velocity)) {
          count++;
          matched = e;
        }
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
        for (const e of fetchEntities(world, changed(Position), not(Dead))) {
          batch.push(e);
        }
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
        for (const e of fetchEntities(world, added(Health), added(Mana))) {
          count++;
          matched = e;
        }
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
        for (const e of fetchEntities(world, added(pair(ChildOf, parent)), Active)) {
          count++;
          matched = e;
        }
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
        for (const e of fetchEntities(world, added(NewState), changed(Position))) {
          batch.push(e);
        }
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

  describe("Change Detection - Query lastTick Isolation", () => {
    it("different queries maintain independent lastTick in systems", async () => {
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
        for (const _ of fetchEntities(world, added(Health))) {
          healthCount1++;
        }
        // Query 2: added(Mana) - independent, should still see the entity
        for (const _ of fetchEntities(world, added(Mana))) {
          manaCount++;
        }
        // Query 1 again: should be empty (its own lastTick was updated)
        for (const _ of fetchEntities(world, added(Health))) {
          healthCount2++;
        }
      });

      await runOnce(world);

      assert.strictEqual(healthCount1, 1);
      assert.strictEqual(manaCount, 1);
      assert.strictEqual(healthCount2, 0);
    });
  });

  describe("Change Detection - Per-System Isolation", () => {
    it("same query in different systems maintains independent lastTick", async () => {
      const world = createWorld();
      const Health = defineComponent("HealthPSI", { value: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Health, { value: 100 });

      const systemAResults: EntityId[] = [];
      const systemBResults: EntityId[] = [];

      // Both systems use the same query (added(Health))
      addSystem(world, function systemA() {
        for (const e of fetchEntities(world, added(Health))) {
          systemAResults.push(e);
        }
      });

      addSystem(world, function systemB() {
        for (const e of fetchEntities(world, added(Health))) {
          systemBResults.push(e);
        }
      });

      await runOnce(world);

      // Both systems should see the entity (independent lastTick per system)
      assert.strictEqual(systemAResults.length, 1);
      assert.strictEqual(systemBResults.length, 1);
    });

    it("systems do not see changes from prior ticks after lastTick updates", async () => {
      const world = createWorld();
      const Health = defineComponent("HealthPSI2", { value: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Health, { value: 100 });

      // Track results across multiple schedule runs
      const results: number[] = [];

      addSystem(world, function tracker() {
        let count = 0;
        for (const _ of fetchEntities(world, added(Health))) {
          count++;
        }
        results.push(count);
      });

      await runOnce(world); // sees 1 (entity added at tick 1)
      await runOnce(world); // sees 0 (lastTick updated)
      await runOnce(world); // sees 0

      assert.deepStrictEqual(results, [1, 0, 0]);
    });

    it("system sees changes made by earlier system in same tick", async () => {
      const world = createWorld();
      const Health = defineComponent("HealthSameTickVis", { value: Type.f32() });

      let systemBSawEntity = false;

      addSystem(world, function systemB() {
        for (const _ of fetchEntities(world, added(Health))) {
          systemBSawEntity = true;
        }
      });

      addSystem(
        world,
        function systemA() {
          const entity = createEntity(world);
          addComponent(world, entity, Health, { value: 50 });
        },
        { before: "systemB" }
      );

      await runOnce(world);

      // systemB runs after systemA in same tick - should see the added entity
      assert.strictEqual(systemBSawEntity, true);
    });

    it("outside-system change detection returns empty for added() and changed()", () => {
      const world = createWorld();
      const Health = defineComponent("HealthOutside", { value: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Health, { value: 100 });

      // added() outside system context returns empty
      const addedResults = [...fetchEntities(world, added(Health))];
      assert.strictEqual(addedResults.length, 0);

      // changed() outside system context returns empty
      const changedResults = [...fetchEntities(world, changed(Health))];
      assert.strictEqual(changedResults.length, 0);
    });

    it("changed() modifier respects per-system isolation", async () => {
      const world = createWorld();
      const Position = defineComponent("PositionPSI", { x: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 0 });

      const systemAResults: EntityId[] = [];
      const systemBResults: EntityId[] = [];

      addSystem(world, function systemB() {
        for (const e of fetchEntities(world, changed(Position))) {
          systemBResults.push(e);
        }
      });

      addSystem(
        world,
        function systemA() {
          for (const e of fetchEntities(world, changed(Position))) {
            systemAResults.push(e);
          }
          // Modify after querying
          setComponentValue(world, entity, Position, "x", systemAResults.length);
        },
        { before: "systemB" }
      );

      await runOnce(world);

      // systemA sees initial add (tick 1 change, lastTick was 0)
      // systemA then modifies Position (stamps change at current tick)
      // systemB sees the change from systemA (lastTick was 0)
      assert.strictEqual(systemAResults.length, 1);
      assert.strictEqual(systemBResults.length, 1);

      // Run again
      await runOnce(world);

      // systemA should NOT see change (its lastTick was updated past change tick)
      // But systemA modifies again (stamps change at new tick)
      // systemB should see the new change
      assert.strictEqual(systemAResults.length, 1); // no new additions
      assert.strictEqual(systemBResults.length, 2); // saw new change
    });
  });

  describe("Change Detection - Edge Cases", () => {
    it("updates lastTick even when loop exits early via break", async () => {
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
        // Break after first entity - should still update lastTick
        for (const _ of fetchEntities(world, added(Health))) {
          breakCount++;
          if (breakCount === 1) break;
        }

        // Second query should see nothing (lastTick was updated despite early exit)
        for (const _ of fetchEntities(world, added(Health))) {
          secondCount++;
        }
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
      addComponent(world, entity, Shield); // re-add in same tick

      let count = 0;

      addSystem(world, function checker() {
        for (const _ of fetchEntities(world, added(Shield))) {
          count++;
        }
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
        for (const e of fetchEntities(world, added(Health))) {
          results.push(e);
        }
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
        for (const e of fetchEntities(world, added(Health))) {
          seen.push(e);
        }
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
});
