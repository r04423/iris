import type { Archetype } from "./archetype.js";
import type { EntityId } from "./encoding.js";
import { ensureEntity } from "./entity.js";
import { fireObserverEvent, registerObserverCallback } from "./observer.js";
import type { World } from "./world.js";

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Filter terms for archetype matching.
 *
 * Specifies inclusion and exclusion constraints for archetype selection.
 */
export type FilterTerms = {
  /**
   * Required component IDs (all must be present).
   */
  include: EntityId[];
  /**
   * Excluded component IDs (none must be present).
   */
  exclude: EntityId[];
};

/**
 * Filter metadata for registry caching.
 *
 * Stores filter terms and matched archetypes.
 */
export type FilterMeta = {
  /**
   * Filter terms (include/exclude constraints).
   */
  terms: FilterTerms;
  /**
   * Matched archetypes (cached result of findMatchingArchetypes).
   */
  archetypes: Archetype[];
};

// ============================================================================
// Filter Hashing
// ============================================================================

/**
 * Generates a unique hash string for filter terms.
 *
 * @param terms - Filter terms containing include/exclude type arrays
 * @returns Deterministic hash string (e.g., "+1:5:12|-3:7")
 *
 * @example
 * const hash = hashFilterTerms({ include: [5, 1, 12], exclude: [7, 3] });
 * // Returns "+1:5:12|-3:7" (sorted for consistency)
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
 * Tests whether an archetype satisfies the given filter terms.
 *
 * @param archetype - Archetype to test against filter
 * @param terms - Filter terms with include/exclude type constraints
 * @returns True if archetype contains ALL included types and NONE of excluded types
 *
 * @example
 * const matches = matchesFilterTerms(archetype, {
 *   include: [PositionType, VelocityType],
 *   exclude: [DisabledType]
 * });
 */
export function matchesFilterTerms(archetype: Archetype, terms: FilterTerms): boolean {
  // Verify ALL required types are present
  for (let i = 0; i < terms.include.length; i++) {
    const typeId = terms.include[i]!;
    if (!archetype.typesSet.has(typeId)) {
      return false;
    }
  }

  // Verify NONE of excluded types are present
  for (let i = 0; i < terms.exclude.length; i++) {
    const typeId = terms.exclude[i]!;
    if (archetype.typesSet.has(typeId)) {
      return false;
    }
  }

  return true;
}

/**
 * Finds all archetypes matching filter terms using rarest-type optimization.
 *
 * Uses the "rarest type first" strategy: starts with the type that appears in
 * the fewest archetypes, then filters that smaller set. This minimizes the
 * number of archetypes we need to check.
 *
 * @param world - World instance containing archetype registry
 * @param terms - Filter terms with include/exclude type constraints
 * @returns Array of archetypes that match all filter criteria
 *
 * @example
 * const archetypes = findMatchingArchetypes(world, {
 *   include: [PositionType, VelocityType],
 *   exclude: []
 * });
 */
export function findMatchingArchetypes(world: World, terms: FilterTerms): Archetype[] {
  // Empty include list is a degenerate case - return no matches
  if (terms.include.length === 0) {
    return [];
  }

  // Find the rarest type (appears in fewest archetypes) for optimal iteration
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
 * Registers a filter in the reverse index (byType) for each included type.
 * @internal
 */
function registerFilterInIndex(world: World, filter: FilterMeta): void {
  const types = filter.terms.include;

  for (let i = 0; i < types.length; i++) {
    const typeId = types[i]!;
    let filters = world.filters.byType.get(typeId);

    if (!filters) {
      filters = [];
      world.filters.byType.set(typeId, filters);
    }

    filters.push(filter);
  }
}

/**
 * Finds the smallest set of filters that could match an archetype by looking up
 * each archetype type in the reverse index and returning the shortest list.
 * @internal
 */
function findRarestFilters(world: World, archetype: Archetype): FilterMeta[] | undefined {
  let rarestFilters: FilterMeta[] | undefined;
  let minCount = Infinity;

  for (let i = 0; i < archetype.types.length; i++) {
    const filters = world.filters.byType.get(archetype.types[i]!);

    if (!filters || filters.length === 0) {
      continue;
    }

    if (filters.length < minCount) {
      rarestFilters = filters;
      minCount = filters.length;
    }
  }

  return rarestFilters;
}

/**
 * Initializes centralized filter dispatch by registering one archetypeCreated
 * and one archetypeDestroyed observer callback. Called once from createWorld.
 * @internal
 */
export function initFilterDispatch(world: World): void {
  registerObserverCallback(world, "archetypeCreated", (archetype) => {
    const filters = findRarestFilters(world, archetype);

    if (!filters) {
      return;
    }

    for (let i = 0; i < filters.length; i++) {
      const filter = filters[i]!;

      if (matchesFilterTerms(archetype, filter.terms)) {
        filter.archetypes.push(archetype);
      }
    }
  });

  registerObserverCallback(world, "archetypeDestroyed", (archetype) => {
    const filters = findRarestFilters(world, archetype);

    if (!filters) {
      return;
    }

    for (let i = 0; i < filters.length; i++) {
      const filter = filters[i]!;
      const idx = filter.archetypes.indexOf(archetype);

      if (idx !== -1) {
        filter.archetypes.splice(idx, 1);
      }
    }
  });
}

// ============================================================================
// Filter Registry
// ============================================================================

/**
 * Gets or creates a filter with reverse-index-based cache invalidation.
 *
 * Filters are cached by their terms hash. When created, the filter is registered
 * in the reverse type index so that centralized archetype dispatch can keep the
 * cached archetype list in sync.
 *
 * @param world - World instance containing filter registry
 * @param terms - Filter terms defining which archetypes to match
 * @returns FilterMeta with cached matching archetypes
 *
 * @example
 * const filter = ensureFilter(world, {
 *   include: [PositionType, VelocityType],
 *   exclude: [DisabledType]
 * });
 * // filter.archetypes contains all matching archetypes
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
