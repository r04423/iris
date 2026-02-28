import assert from "node:assert";
import { describe, it } from "node:test";
import { createAndRegisterArchetype, destroyArchetype } from "./archetype.js";
import { addComponent } from "./component.js";
import type { EntityId } from "./encoding.js";
import { createEntity, destroyEntity } from "./entity.js";
import { ensureFilter, findMatchingArchetypes, hashFilterTerms, matchesFilterTerms } from "./filters.js";
import { defineRelation } from "./registry.js";
import { pair } from "./relation.js";
import { createWorld } from "./world.js";

describe("Filters", () => {
  describe("Archetype Matching", () => {
    it("matches archetype with all included types", () => {
      const world = createWorld();
      const c1 = createEntity(world);
      const c2 = createEntity(world);
      const c3 = createEntity(world);
      const archetype = createAndRegisterArchetype(world, [c1, c2, c3], new Map());
      const terms = { include: [c1, c2], exclude: [] };

      assert.strictEqual(matchesFilterTerms(archetype, terms), true);
    });

    it("rejects archetype missing included type", () => {
      const world = createWorld();
      const c1 = createEntity(world);
      const c2 = createEntity(world);
      const c3 = createEntity(world);
      const archetype = createAndRegisterArchetype(world, [c1, c3], new Map());
      const terms = { include: [c1, c2, c3], exclude: [] };

      assert.strictEqual(matchesFilterTerms(archetype, terms), false);
    });

    it("matches with empty include and exclude", () => {
      const world = createWorld();
      const c1 = createEntity(world);
      const c2 = createEntity(world);
      const c3 = createEntity(world);
      const archetype = createAndRegisterArchetype(world, [c1, c2, c3], new Map());
      const terms = { include: [], exclude: [] };

      assert.strictEqual(matchesFilterTerms(archetype, terms), true);
    });

    it("rejects archetype with excluded type", () => {
      const world = createWorld();
      const c1 = createEntity(world);
      const c2 = createEntity(world);
      const c3 = createEntity(world);
      const archetype = createAndRegisterArchetype(world, [c1, c2, c3], new Map());
      const terms = { include: [c1], exclude: [c2] };

      assert.strictEqual(matchesFilterTerms(archetype, terms), false);
    });

    it("matches archetype without excluded type", () => {
      const world = createWorld();
      const c1 = createEntity(world);
      const c2 = createEntity(world);
      const c3 = createEntity(world);
      const archetype = createAndRegisterArchetype(world, [c1, c3], new Map());
      const terms = { include: [c1], exclude: [c2] };

      assert.strictEqual(matchesFilterTerms(archetype, terms), true);
    });

    it("handles multiple excluded types", () => {
      const world = createWorld();
      const c1 = createEntity(world);
      const c2 = createEntity(world);
      const c3 = createEntity(world);
      const c4 = createEntity(world);
      const c5 = createEntity(world);
      const archetype = createAndRegisterArchetype(world, [c1, c2], new Map());
      const terms = { include: [c1], exclude: [c3, c4, c5] };

      assert.strictEqual(matchesFilterTerms(archetype, terms), true);
    });

    it("rejects if any excluded type is present", () => {
      const world = createWorld();
      const c1 = createEntity(world);
      const c2 = createEntity(world);
      const c3 = createEntity(world);
      const c4 = createEntity(world);
      const c5 = createEntity(world);
      const archetype = createAndRegisterArchetype(world, [c1, c2, c3], new Map());
      const terms = { include: [c1], exclude: [c2, c4, c5] };

      assert.strictEqual(matchesFilterTerms(archetype, terms), false);
    });
  });

  describe("Find Matching Archetypes", () => {
    it("returns archetypes with all included types", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      const archetype1 = createAndRegisterArchetype(world, [Position, Velocity], new Map());
      createAndRegisterArchetype(world, [Position], new Map()); // Only Position (should not match)
      createAndRegisterArchetype(world, [Velocity], new Map()); // Only Velocity (should not match)

      const terms = { include: [Position, Velocity], exclude: [] };
      const matches = findMatchingArchetypes(world, terms);

      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches[0], archetype1);
    });

    it("throws for invalid component ID (fail-fast)", () => {
      const world = createWorld();
      const Position = createEntity(world);

      createAndRegisterArchetype(world, [Position], new Map());

      // Raw number without type bits is invalid
      const terms = { include: [999] as EntityId[], exclude: [] };

      assert.throws(() => {
        findMatchingArchetypes(world, terms);
      }, /Invalid entity type/);
    });

    it("returns empty array for empty include", () => {
      const world = createWorld();
      const Position = createEntity(world);

      createAndRegisterArchetype(world, [Position], new Map());

      const terms = { include: [], exclude: [] };
      const matches = findMatchingArchetypes(world, terms);

      assert.strictEqual(matches.length, 0);
    });

    it("excludes archetypes with excluded types", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);
      const Health = createEntity(world);

      const archetype1 = createAndRegisterArchetype(world, [Position, Velocity], new Map());
      createAndRegisterArchetype(world, [Position, Health], new Map()); // Has Health (should be excluded)
      createAndRegisterArchetype(world, [Position, Velocity, Health], new Map()); // Has Health (should be excluded)

      const terms = { include: [Position], exclude: [Health] };
      const matches = findMatchingArchetypes(world, terms);

      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches[0], archetype1);
    });

    it("combines include and exclude constraints", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);
      const Health = createEntity(world);
      const Dead = createEntity(world);

      const archetype1 = createAndRegisterArchetype(world, [Position, Velocity], new Map());
      createAndRegisterArchetype(world, [Position], new Map()); // Missing Velocity (should not match)
      createAndRegisterArchetype(world, [Position, Velocity, Health], new Map()); // Has Health (should be excluded)
      createAndRegisterArchetype(world, [Position, Velocity, Dead], new Map()); // Has Dead (should be excluded)

      const terms = { include: [Position, Velocity], exclude: [Health, Dead] };
      const matches = findMatchingArchetypes(world, terms);

      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches[0], archetype1);
    });
  });

  describe("Filter Hashing", () => {
    it("creates consistent hash for same filter terms", () => {
      const terms1 = { include: [1, 5, 12] as EntityId[], exclude: [3, 7] as EntityId[] };
      const terms2 = { include: [1, 5, 12] as EntityId[], exclude: [3, 7] as EntityId[] };

      const hash1 = hashFilterTerms(terms1);
      const hash2 = hashFilterTerms(terms2);

      assert.strictEqual(hash1, hash2);
    });

    it("creates different hashes for different include arrays", () => {
      const terms1 = { include: [1, 5, 12] as EntityId[], exclude: [3, 7] as EntityId[] };
      const terms2 = { include: [1, 5] as EntityId[], exclude: [3, 7] as EntityId[] };

      const hash1 = hashFilterTerms(terms1);
      const hash2 = hashFilterTerms(terms2);

      assert.notStrictEqual(hash1, hash2);
    });

    it("creates different hashes for different exclude arrays", () => {
      const terms1 = { include: [1, 5] as EntityId[], exclude: [3, 7] as EntityId[] };
      const terms2 = { include: [1, 5] as EntityId[], exclude: [3, 7, 12] as EntityId[] };

      const hash1 = hashFilterTerms(terms1);
      const hash2 = hashFilterTerms(terms2);

      assert.notStrictEqual(hash1, hash2);
    });

    it("sorts include and exclude arrays for consistent hashing", () => {
      const terms1 = { include: [12, 1, 5] as EntityId[], exclude: [7, 3] as EntityId[] };
      const terms2 = { include: [1, 5, 12] as EntityId[], exclude: [3, 7] as EntityId[] };

      const hash1 = hashFilterTerms(terms1);
      const hash2 = hashFilterTerms(terms2);

      assert.strictEqual(hash1, hash2);
    });

    it("handles empty include and exclude arrays", () => {
      const terms = { include: [], exclude: [] };
      const hash = hashFilterTerms(terms);

      assert.strictEqual(hash, "+|-");
    });

    it("handles empty include with non-empty exclude", () => {
      const terms = { include: [], exclude: [3, 7] as EntityId[] };
      const hash = hashFilterTerms(terms);

      assert.strictEqual(hash, "+|-3:7");
    });

    it("handles non-empty include with empty exclude", () => {
      const terms = { include: [1, 5] as EntityId[], exclude: [] };
      const hash = hashFilterTerms(terms);

      assert.strictEqual(hash, "+1:5|-");
    });

    it("uses colon-delimited format", () => {
      const terms = { include: [1, 5, 12] as EntityId[], exclude: [3, 7] as EntityId[] };
      const hash = hashFilterTerms(terms);

      assert.strictEqual(hash, "+1:5:12|-3:7");
    });
  });

  describe("Filter Registry", () => {
    it("caches filter metadata on first access", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      createAndRegisterArchetype(world, [Position, Velocity], new Map());

      const terms = { include: [Position], exclude: [] };
      const filterMeta = ensureFilter(world, terms);

      assert.strictEqual(filterMeta.terms, terms);
      assert.strictEqual(filterMeta.archetypes.length, 1);
    });

    it("reuses cached filter on subsequent access", () => {
      const world = createWorld();
      const Position = createEntity(world);

      createAndRegisterArchetype(world, [Position], new Map());

      const terms = { include: [Position], exclude: [] };
      const filterMeta1 = ensureFilter(world, terms);
      const filterMeta2 = ensureFilter(world, terms);

      assert.strictEqual(filterMeta1, filterMeta2);
    });

    it("does not update filter when non-matching archetype is created", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      createAndRegisterArchetype(world, [Position], new Map());

      const terms = { include: [Position], exclude: [] };
      const filterMeta = ensureFilter(world, terms);

      assert.strictEqual(filterMeta.archetypes.length, 1);

      // Create non-matching archetype (no Position)
      createAndRegisterArchetype(world, [Velocity], new Map());

      // Filter should not be updated
      assert.strictEqual(filterMeta.archetypes.length, 1);
    });

    it("updates filter automatically when archetype is destroyed", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Dead = createEntity(world);

      const archetype1 = createAndRegisterArchetype(world, [Position], new Map());
      const archetype2 = createAndRegisterArchetype(world, [Position, Dead], new Map());

      const terms = { include: [Position], exclude: [] };
      const filterMeta = ensureFilter(world, terms);

      assert.strictEqual(filterMeta.archetypes.length, 2);

      // Destroy one archetype
      destroyArchetype(world, archetype2);

      // Same filter instance should be updated via observer callbacks
      assert.strictEqual(filterMeta.archetypes.length, 1);
      assert.strictEqual(filterMeta.archetypes[0], archetype1);
    });

    it("stores filters in world.filters.byId registry", () => {
      const world = createWorld();
      const Position = createEntity(world);

      createAndRegisterArchetype(world, [Position], new Map());

      const terms = { include: [Position], exclude: [] };
      ensureFilter(world, terms);

      const filterId = hashFilterTerms(terms);
      const storedFilter = world.filters.byId.get(filterId);

      assert.ok(storedFilter);
      assert.strictEqual(storedFilter.terms, terms);
    });

    it("handles multiple different filters independently", () => {
      const world = createWorld();
      const Position = createEntity(world);
      const Velocity = createEntity(world);

      createAndRegisterArchetype(world, [Position], new Map());
      createAndRegisterArchetype(world, [Velocity], new Map());
      createAndRegisterArchetype(world, [Position, Velocity], new Map());

      const terms1 = { include: [Position], exclude: [] };
      const terms2 = { include: [Velocity], exclude: [] };

      const filterMeta1 = ensureFilter(world, terms1);
      const filterMeta2 = ensureFilter(world, terms2);

      assert.strictEqual(filterMeta1.archetypes.length, 2); // Position, Position+Velocity
      assert.strictEqual(filterMeta2.archetypes.length, 2); // Velocity, Position+Velocity
      assert.notStrictEqual(filterMeta1, filterMeta2);
    });
  });

  // ============================================================================
  // Filter Dispatch (filter created before archetype)
  // ============================================================================

  describe("Filter Dispatch", () => {
    it("matches archetype created after filter registration", () => {
      const world = createWorld();
      const A = createEntity(world);
      const B = createEntity(world);

      // Filter exists before any matching archetype
      const filter = ensureFilter(world, { include: [A, B], exclude: [] });
      assert.strictEqual(filter.archetypes.length, 0);

      // Archetype created later, observer must pick it up
      const archetype = createAndRegisterArchetype(world, [A, B], new Map());

      assert.strictEqual(filter.archetypes.length, 1);
      assert.strictEqual(filter.archetypes[0], archetype);
    });

    it("matches archetype with superset of filter types", () => {
      const world = createWorld();
      const A = createEntity(world);
      const B = createEntity(world);
      const C = createEntity(world);
      const D = createEntity(world);
      const E = createEntity(world);

      // Filter only requires [A, B]
      const filter = ensureFilter(world, { include: [A, B], exclude: [] });

      // Archetype has [A, B, C, D, E], filter stored under one type must still match
      const archetype = createAndRegisterArchetype(world, [A, B, C, D, E], new Map());

      assert.strictEqual(filter.archetypes.length, 1);
      assert.strictEqual(filter.archetypes[0], archetype);
    });

    it("handles multiple filters with overlapping include types", () => {
      const world = createWorld();
      const A = createEntity(world);
      const B = createEntity(world);
      const C = createEntity(world);

      const filterAB = ensureFilter(world, { include: [A, B], exclude: [] });
      const filterAC = ensureFilter(world, { include: [A, C], exclude: [] });
      const filterBC = ensureFilter(world, { include: [B, C], exclude: [] });

      // Archetype matches all three filters
      const archetype = createAndRegisterArchetype(world, [A, B, C], new Map());

      assert.strictEqual(filterAB.archetypes.length, 1);
      assert.strictEqual(filterAC.archetypes.length, 1);
      assert.strictEqual(filterBC.archetypes.length, 1);
      assert.strictEqual(filterAB.archetypes[0], archetype);
      assert.strictEqual(filterAC.archetypes[0], archetype);
      assert.strictEqual(filterBC.archetypes[0], archetype);
    });

    it("only updates matching filters when archetype is created", () => {
      const world = createWorld();

      const A = createEntity(world);
      const B = createEntity(world);
      const C = createEntity(world);

      const filterAB = ensureFilter(world, { include: [A, B], exclude: [] });
      const filterC = ensureFilter(world, { include: [C], exclude: [] });

      // Archetype {A, B} matches filterAB but not filterC
      createAndRegisterArchetype(world, [A, B], new Map());

      assert.strictEqual(filterAB.archetypes.length, 1);
      assert.strictEqual(filterC.archetypes.length, 0);
    });

    it("handles filter registered under rare type when common type has many filters", () => {
      const world = createWorld();
      const Common = createEntity(world);
      const Rare = createEntity(world);

      // Create many filters that include Common to make it "popular"
      const extras: EntityId[] = [];

      for (let i = 0; i < 10; i++) {
        const extra = createEntity(world);
        extras.push(extra);
        ensureFilter(world, { include: [Common, extra], exclude: [] });
      }

      // This filter should be registered under Rare (fewer filters)
      const filter = ensureFilter(world, { include: [Common, Rare], exclude: [] });

      // Create archetype that matches
      const archetype = createAndRegisterArchetype(
        world,
        [Common, Rare, ...extras.slice(0, 2)].sort((a, b) => a - b) as EntityId[],
        new Map()
      );

      assert.ok(filter.archetypes.includes(archetype));
    });

    it("respects exclude terms during dispatch", () => {
      const world = createWorld();
      const A = createEntity(world);
      const B = createEntity(world);
      const Excluded = createEntity(world);

      const filter = ensureFilter(world, { include: [A, B], exclude: [Excluded] });

      // Archetype with excluded type should not match
      createAndRegisterArchetype(world, [A, B, Excluded], new Map());
      assert.strictEqual(filter.archetypes.length, 0);

      // Archetype without excluded type should match
      const good = createAndRegisterArchetype(world, [A, B], new Map());
      assert.strictEqual(filter.archetypes.length, 1);
      assert.strictEqual(filter.archetypes[0], good);
    });

    it("handles filter created between archetype creations", () => {
      const world = createWorld();
      const A = createEntity(world);
      const B = createEntity(world);
      const C = createEntity(world);

      // First archetype exists before filter
      const arch1 = createAndRegisterArchetype(world, [A, B], new Map());

      const filter = ensureFilter(world, { include: [A, B], exclude: [] });
      assert.strictEqual(filter.archetypes.length, 1);
      assert.strictEqual(filter.archetypes[0], arch1);

      // Second archetype created after filter
      const arch2 = createAndRegisterArchetype(world, [A, B, C], new Map());
      assert.strictEqual(filter.archetypes.length, 2);
      assert.ok(filter.archetypes.includes(arch2));
    });
  });

  // ============================================================================
  // Filter Lifecycle (Persistent)
  // ============================================================================

  describe("Filter Lifecycle", () => {
    it("persists filter when all matching archetypes are destroyed", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const archetype = createAndRegisterArchetype(world, [Position], new Map());

      const terms = { include: [Position], exclude: [] };
      const filterMeta = ensureFilter(world, terms);

      assert.strictEqual(world.filters.byId.size, 1);

      destroyArchetype(world, archetype);

      // Filter persists with empty archetype list
      assert.strictEqual(world.filters.byId.size, 1);
      assert.strictEqual(filterMeta.archetypes.length, 0);
    });

    it("re-matches when new archetype appears after all were destroyed", () => {
      const world = createWorld();
      const Position = createEntity(world);

      const archetype1 = createAndRegisterArchetype(world, [Position], new Map());

      const terms = { include: [Position], exclude: [] };
      const filterMeta = ensureFilter(world, terms);

      destroyArchetype(world, archetype1);
      assert.strictEqual(filterMeta.archetypes.length, 0);

      // Create new archetype, same filter instance should re-match
      const archetype2 = createAndRegisterArchetype(world, [Position], new Map());

      assert.strictEqual(filterMeta.archetypes.length, 1);
      assert.strictEqual(filterMeta.archetypes[0], archetype2);
    });

    it("re-matches after pair target destroyed and re-established", () => {
      const world = createWorld();
      const ChildOf = defineRelation("ChildOf");

      const parent = createEntity(world);
      const child = createEntity(world);
      addComponent(world, child, pair(ChildOf, parent));

      const pairType = pair(ChildOf, parent);
      const filter = ensureFilter(world, { include: [pairType], exclude: [] });

      assert.ok(filter.archetypes.length > 0);

      // Destroy parent cascades: removes pair from child, destroys pair archetypes
      destroyEntity(world, parent);
      assert.strictEqual(filter.archetypes.length, 0);

      // New parent recycles same raw ID, pair encodes identically
      const newParent = createEntity(world);
      assert.notStrictEqual(newParent, parent);
      assert.strictEqual(pair(ChildOf, newParent), pairType);

      const newChild = createEntity(world);
      addComponent(world, newChild, pair(ChildOf, newParent));

      // Same filter instance re-matches the new archetype
      assert.ok(filter.archetypes.length > 0);
    });
  });
});
