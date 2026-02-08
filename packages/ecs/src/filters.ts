import type { Archetype } from "./archetype.js";
import type { EntityId } from "./encoding.js";
import { ensureEntity } from "./entity.js";
import type { Observer } from "./observer.js";
import { fireObserverEvent, registerObserverCallback, unregisterObserverCallback } from "./observer.js";
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
 * Stores filter terms, matched archetypes, and observer callbacks.
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
  /**
   * Observer callback for archetype creation.
   */
  onArchetypeCreate: Observer<"archetypeCreated">;
  /**
   * Observer callback for archetype destruction.
   */
  onArchetypeDelete: Observer<"archetypeDestroyed">;
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
// Filter Registry
// ============================================================================

/**
 * Destroys a filter and cleans up its observer callbacks.
 * Called when a filter's archetype cache becomes empty.
 */
function destroyFilter(world: World, filterId: string): void {
  const filter = world.filters.byId.get(filterId)!;

  // Unregister callbacks to prevent memory leaks and stale references
  unregisterObserverCallback(world, "archetypeCreated", filter.onArchetypeCreate);
  unregisterObserverCallback(world, "archetypeDestroyed", filter.onArchetypeDelete);

  fireObserverEvent(world, "filterDestroyed", filter);
  world.filters.byId.delete(filterId);
}

/**
 * Gets or creates a filter with observer-based cache invalidation.
 *
 * Filters are cached by their terms hash. When created, observers are registered
 * to automatically update the cached archetype list as archetypes are created
 * or destroyed.
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
    // Create new filter with observer callbacks that close over terms and filterMeta
    filterMeta = {
      terms,
      archetypes: findMatchingArchetypes(world, terms),

      // Called when a new archetype is created - add to cache if it matches
      onArchetypeCreate: (archetype) => {
        if (!matchesFilterTerms(archetype, terms)) {
          return;
        }
        filterMeta!.archetypes.push(archetype);
      },

      // Called when an archetype is destroyed - remove from cache, cleanup if empty
      onArchetypeDelete: (archetype) => {
        const idx = filterMeta!.archetypes.indexOf(archetype);
        if (idx !== -1) {
          filterMeta!.archetypes.splice(idx, 1);
        }

        // Auto-cleanup: destroy filter when it has no matching archetypes
        if (filterMeta!.archetypes.length === 0) {
          destroyFilter(world, filterId);
        }
      },
    };

    world.filters.byId.set(filterId, filterMeta);

    // Register observers to keep archetype cache in sync
    registerObserverCallback(world, "archetypeCreated", filterMeta.onArchetypeCreate);
    registerObserverCallback(world, "archetypeDestroyed", filterMeta.onArchetypeDelete);
    fireObserverEvent(world, "filterCreated", filterMeta);
  }

  return filterMeta;
}

// ============================================================================
// Filter Iteration
// ============================================================================

/**
 * Iterates all entities matching a filter in reverse order.
 *
 * Reverse iteration allows safe entity deletion during iteration without
 * skipping entities or invalidating indices.
 *
 * @param filter - Filter metadata containing cached matching archetypes
 * @returns Generator yielding entity IDs from all matching archetypes
 *
 * @example
 * for (const entity of iterateFilterEntities(filter)) {
 *   // Safe to delete entity here due to reverse iteration
 *   destroyEntity(world, entity);
 * }
 */
export function* iterateFilterEntities(filter: FilterMeta): IterableIterator<EntityId> {
  const archetypes = filter.archetypes;

  for (let a = 0; a < archetypes.length; a++) {
    const archetype = archetypes[a]!;
    const entities = archetype.entities;

    // Reverse iteration enables safe deletion during traversal
    for (let i = entities.length - 1; i >= 0; i--) {
      yield entities[i]!;
    }
  }
}
