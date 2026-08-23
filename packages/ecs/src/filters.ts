import type { Archetype } from "./archetype.js";
import type { EntityId } from "./encoding.js";
import { ensureEntity } from "./entity.js";
import { fireObserverEvent, registerObserverCallback } from "./observer.js";
import type { World } from "./world.js";

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Inclusion and exclusion constraints for matching entities by component set.
 *
 * An entity matches when it has every `include` component and none of the
 * `exclude` components. Query operations expand their terms into filters of
 * this shape.
 *
 * @example
 * ```typescript
 * const terms: FilterTerms = { include: [Position, Velocity], exclude: [Player] };
 * ```
 */
export type FilterTerms = {
  /** Required component IDs (all must be present). */
  include: EntityId[];
  /** Excluded component IDs (none must be present). */
  exclude: EntityId[];
};

/**
 * A cached filter: its terms plus the live list of matching archetypes,
 * kept current by the observers registered in {@link initFilterDispatch}.
 * @internal
 */
export type FilterMeta = {
  /** Filter terms (include/exclude constraints). */
  terms: FilterTerms;
  /** Live list of matching archetypes. */
  archetypes: Archetype[];
};

// ============================================================================
// Filter State
// ============================================================================

/**
 * Filter registry for query caching.
 * @internal
 */
export type FilterState = {
  /** Filter metadata lookup (filter hash -> metadata). */
  byId: Map<string, FilterMeta>;
  /** Reverse index: type ID -> filters that include it. */
  byType: Map<EntityId, FilterMeta[]>;
};

/**
 * Creates an empty filter registry.
 * @internal
 */
export function createFilterState(): FilterState {
  return {
    byId: new Map(),
    byType: new Map(),
  };
}

/**
 * Clears the world's filter registry and cached archetype matches.
 * @internal
 */
export function resetFilterState(world: World): void {
  for (const filter of world.filters.byId.values()) {
    filter.archetypes.length = 0;
  }

  world.filters.byId.clear();
  world.filters.byType.clear();
}

// ============================================================================
// Filter Hashing
// ============================================================================

/**
 * Hashes filter terms into a deterministic cache key (e.g. "+1:5:12|-3:7").
 * @internal
 */
export function hashFilterTerms(terms: FilterTerms): string {
  // Sort to ensure same terms always produce same hash regardless of input order
  const includeHash = terms.include.toSorted((a, b) => a - b).join(":");
  const excludeHash = terms.exclude.toSorted((a, b) => a - b).join(":");
  return `+${includeHash}|-${excludeHash}`;
}

// ============================================================================
// Archetype Matching
// ============================================================================

/**
 * Tests whether an archetype has every included type and no excluded type.
 * @internal
 */
export function matchesFilterTerms(archetype: Archetype, terms: FilterTerms): boolean {
  for (let i = 0; i < terms.include.length; i++) {
    const typeId = terms.include[i]!;
    if (!archetype.typesSet.has(typeId)) {
      return false;
    }
  }

  for (let i = 0; i < terms.exclude.length; i++) {
    const typeId = terms.exclude[i]!;
    if (archetype.typesSet.has(typeId)) {
      return false;
    }
  }

  return true;
}

/**
 * Scans for all archetypes matching the terms, iterating only the archetypes
 * of the rarest included type -- the smallest candidate set that still
 * contains every possible match.
 * @internal
 */
export function findMatchingArchetypes(world: World, terms: FilterTerms): Archetype[] {
  // Empty include list is a degenerate case - return no matches
  if (terms.include.length === 0) {
    return [];
  }

  // Pick the included type appearing in the fewest archetypes
  let rarestMeta = ensureEntity(world, terms.include[0]!);
  let minCount = rarestMeta.records.length;

  if (minCount === 0) {
    return [];
  }

  for (let i = 1; i < terms.include.length; i++) {
    const typeId = terms.include[i]!;
    const meta = ensureEntity(world, typeId);

    const count = meta.records.length;
    if (count === 0) {
      // If any required type has zero archetypes, no matches are possible
      return [];
    }

    if (count < minCount) {
      rarestMeta = meta;
      minCount = count;
    }
  }

  const archetypes = rarestMeta.records;
  const matches: Archetype[] = [];

  for (let a = 0; a < archetypes.length; a++) {
    const archetype = archetypes[a]!;
    if (matchesFilterTerms(archetype, terms)) {
      matches.push(archetype);
    }
  }

  return matches;
}

// ============================================================================
// Reverse Filter Index
// ============================================================================

/**
 * Registers a filter in the reverse index (byType) under exactly one included
 * type -- the one with the fewest registered filters, keeping per-type lists
 * short.
 */
function registerFilterInIndex(world: World, filter: FilterMeta): void {
  const types = filter.terms.include;

  if (types.length === 0) {
    return;
  }

  // Pick the type with the fewest existing filters for load balancing
  let bestTypeId = types[0]!;
  let minCount = world.filters.byType.get(bestTypeId)?.length ?? 0;

  for (let i = 1; i < types.length; i++) {
    const typeId = types[i]!;
    const count = world.filters.byType.get(typeId)?.length ?? 0;

    if (count < minCount) {
      bestTypeId = typeId;
      minCount = count;
    }
  }

  let filters = world.filters.byType.get(bestTypeId);

  if (!filters) {
    filters = [];
    world.filters.byType.set(bestTypeId, filters);
  }

  filters.push(filter);
}

/**
 * Registers the archetypeCreated/archetypeDestroyed callbacks that keep every
 * filter's archetype cache current. Called once from createWorld, before the
 * root archetype registers. Each filter lives under exactly one of its
 * included types, so scanning an archetype's types visits every affected
 * filter exactly once.
 * @internal
 */
export function initFilterDispatch(world: World): void {
  registerObserverCallback(world, "archetypeCreated", (archetype) => {
    for (let i = 0; i < archetype.types.length; i++) {
      const filters = world.filters.byType.get(archetype.types[i]!);

      if (!filters) {
        continue;
      }

      for (let j = 0; j < filters.length; j++) {
        const filter = filters[j]!;

        if (matchesFilterTerms(archetype, filter.terms)) {
          filter.archetypes.push(archetype);
        }
      }
    }
  });

  registerObserverCallback(world, "archetypeDestroyed", (archetype) => {
    for (let i = 0; i < archetype.types.length; i++) {
      const filters = world.filters.byType.get(archetype.types[i]!);

      if (!filters) {
        continue;
      }

      for (let j = 0; j < filters.length; j++) {
        const filter = filters[j]!;
        const idx = filter.archetypes.indexOf(archetype);

        if (idx !== -1) {
          filter.archetypes.splice(idx, 1);
        }
      }
    }
  });
}

// ============================================================================
// Filter Registry
// ============================================================================

/**
 * Gets or creates the cached filter for the given terms (keyed by hash).
 * New filters snapshot the currently matching archetypes, join the reverse
 * index so dispatch keeps them in sync, and fire `filterCreated`.
 * @internal
 */
export function ensureFilter(world: World, terms: FilterTerms): FilterMeta {
  const filterId = hashFilterTerms(terms);
  let filterMeta = world.filters.byId.get(filterId);

  if (!filterMeta) {
    filterMeta = {
      terms,
      archetypes: findMatchingArchetypes(world, terms),
    };

    world.filters.byId.set(filterId, filterMeta);

    registerFilterInIndex(world, filterMeta);
    fireObserverEvent(world, "filterCreated", filterMeta);
  }

  return filterMeta;
}
