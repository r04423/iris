import type { EntityId } from "./encoding.js";
import type { FilterMeta } from "./filters.js";
import { ensureFilter, iterateFilterEntities } from "./filters.js";
import type { Observer } from "./observer.js";
import { registerObserverCallback, unregisterObserverCallback } from "./observer.js";
import type { World } from "./world.js";

// ============================================================================
// Query Metadata
// ============================================================================

/**
 * Query metadata for registry caching.
 *
 * Stores required and excluded components with reference to underlying filter.
 */
export type QueryMeta = {
  /**
   * Required components.
   */
  include: EntityId[];

  /**
   * Excluded components.
   */
  exclude: EntityId[];

  /**
   * Direct reference to underlying filter.
   */
  filter: FilterMeta;

  /**
   * Observer callback for filter destruction.
   */
  onFilterDestroy: Observer<"filterDestroyed">;

  /**
   * Components with added() modifier.
   */
  added: EntityId[];

  /**
   * Components with changed() modifier.
   */
  changed: EntityId[];

  /**
   * Execution tick tracking for change detection.
   */
  lastTick: {
    /**
     * Tick when query last executed outside any system.
     */
    self: number;
    /**
     * Per-system execution ticks: systemId -> tick
     */
    bySystemId: Map<string, number>;
  };
};

// ============================================================================
// Query Modifiers
// ============================================================================

export type ModifierType = "not" | "added" | "changed";
export type NotModifier = { type: "not"; componentId: EntityId };
export type AddedModifier = { type: "added"; componentId: EntityId };
export type ChangedModifier = { type: "changed"; componentId: EntityId };
export type QueryModifier = NotModifier | AddedModifier | ChangedModifier;

/**
 * Create exclusion modifier for query.
 *
 * @param componentId - Component to exclude from query results
 * @returns Not modifier
 *
 * @example
 * ```typescript
 * fetchEntities(world, Position, not(Dead))
 * ```
 */
export function not(componentId: EntityId): NotModifier {
  return { type: "not", componentId };
}

/**
 * Create added modifier for change detection.
 *
 * Matches entities where component was added since last query execution.
 *
 * @param componentId - Component to check for addition
 * @returns Added modifier
 *
 * @example
 * for (const entity of fetchEntities(world, added(Enemy))) { ... }
 */
export function added(componentId: EntityId): AddedModifier {
  return { type: "added", componentId };
}

/**
 * Create changed modifier for change detection.
 *
 * Matches entities where component was modified or added since last query execution.
 *
 * @param componentId - Component to check for changes
 * @returns Changed modifier
 *
 * @example
 * for (const entity of fetchEntities(world, changed(Health))) { ... }
 */
export function changed(componentId: EntityId): ChangedModifier {
  return { type: "changed", componentId };
}

/**
 * Check if argument is a query modifier (not, added, changed) vs plain component ID.
 */
function isModifier(arg: unknown): arg is QueryModifier {
  return typeof arg === "object" && arg !== null && "type" in arg && "componentId" in arg;
}

// ============================================================================
// Query Hashing
// ============================================================================

/**
 * Hash query terms to unique string ID for cache lookup.
 *
 * @param include - Component IDs that must be present
 * @param exclude - Component IDs that must not be present
 * @param added - Component IDs to check for recent addition
 * @param changed - Component IDs to check for recent modification
 * @returns Query ID in format "+include|-exclude|~+added|~>changed"
 *
 * @example
 * ```typescript
 * const id = hashQuery([Position, Velocity], [Dead], [], []);
 * ```
 */
export function hashQuery(include: EntityId[], exclude: EntityId[], added: EntityId[], changed: EntityId[]): string {
  // Sort to ensure consistent hashing regardless of term order
  const join = (arr: EntityId[]) => arr.toSorted((a, b) => a - b).join(":");

  return `+${join(include)}|-${join(exclude)}|~+${join(added)}|~>${join(changed)}`;
}

// ============================================================================
// Query Registry Operations
// ============================================================================

/**
 * Ensure query exists in registry, creating if necessary.
 *
 * @param world - World instance
 * @param terms - Components and modifiers
 * @returns Query metadata
 * @throws {Error} If no included components (query must match something)
 *
 * @example
 * const query = ensureQuery(world, Position, Velocity, not(Dead));
 */
export function ensureQuery(world: World, ...terms: (EntityId | QueryModifier)[]): QueryMeta {
  const include: EntityId[] = [];
  const exclude: EntityId[] = [];
  const added: EntityId[] = [];
  const changed: EntityId[] = [];

  // Separate terms into categories based on modifier type
  for (const term of terms) {
    if (isModifier(term)) {
      switch (term.type) {
        case "not":
          exclude.push(term.componentId);
          break;
        case "added":
          added.push(term.componentId);
          break;
        case "changed":
          changed.push(term.componentId);
          break;
      }
    } else {
      include.push(term);
    }
  }

  // Filter must include added/changed components since they must be present on entity
  const filterInclude = include.concat(added, changed);

  if (filterInclude.length === 0) {
    throw new Error("Query must include at least one component");
  }

  const queryId = hashQuery(include, exclude, added, changed);

  let queryMeta = world.queries.byId.get(queryId);

  if (!queryMeta) {
    const filterMeta = ensureFilter(world, { include: filterInclude, exclude });

    queryMeta = {
      include,
      exclude,
      added,
      changed,

      filter: filterMeta,

      lastTick: {
        self: 0,
        bySystemId: new Map(),
      },

      // Callback to clean up query when its underlying filter is destroyed
      onFilterDestroy: (destroyedFilter) => {
        if (destroyedFilter !== filterMeta) {
          return;
        }

        // Self-cleanup: unregister callback and remove from registry
        unregisterObserverCallback(world, "filterDestroyed", queryMeta!.onFilterDestroy);
        world.queries.byId.delete(queryId);
      },
    };

    world.queries.byId.set(queryId, queryMeta);

    // Register for filter destruction events to enable automatic cleanup
    registerObserverCallback(world, "filterDestroyed", queryMeta.onFilterDestroy);
  }

  return queryMeta;
}

/**
 * Fetch entities using pre-registered query metadata.
 *
 * Filters by change modifiers (added/changed) when present and updates
 * lastTick after iteration for per-query/per-system change tracking.
 *
 * @param world - World instance
 * @param queryMeta - Query metadata from ensureQuery()
 * @returns Entity IDs in backward order (safe for deletion during iteration)
 *
 * @example
 * ```typescript
 * const query = ensureQuery(world, Position, Velocity);
 * for (const entity of fetchEntitiesWithQuery(world, query)) {
 *   // Process entity
 * }
 * ```
 */
export function* fetchEntitiesWithQuery(world: World, queryMeta: QueryMeta): IterableIterator<EntityId> {
  const hasChangeModifiers = queryMeta.added.length > 0 || queryMeta.changed.length > 0;

  // Fast path: no change modifiers
  if (!hasChangeModifiers) {
    yield* iterateFilterEntities(queryMeta.filter);
    return;
  }

  // Slow path: filter by change detection using archetype-local tick arrays.
  // Each component tracks when it was added/changed per-entity via tick timestamps.
  const { systemId, tick } = world.execution;

  // Get lastTick for this execution context (global or per-system)
  const lastTick = systemId === null ? queryMeta.lastTick.self : (queryMeta.lastTick.bySystemId.get(systemId) ?? 0);

  const archetypes = queryMeta.filter.archetypes;

  // Pre-allocated arrays reused across archetypes to avoid allocation in hot loop
  const addedTickArrays: Uint32Array[] = [];
  const changedTickArrays: Uint32Array[] = [];

  // Use try/finally to ensure lastTick updates even on early exit (break/return/throw).
  try {
    for (let a = 0; a < archetypes.length; a++) {
      const archetype = archetypes[a]!;
      const entities = archetype.entities;

      // Pre-fetch tick arrays for this archetype (one Map lookup per component per archetype)
      addedTickArrays.length = 0;
      for (let j = 0; j < queryMeta.added.length; j++) {
        const ticks = archetype.ticks.get(queryMeta.added[j]!);
        if (ticks) addedTickArrays.push(ticks.added);
      }

      changedTickArrays.length = 0;
      for (let j = 0; j < queryMeta.changed.length; j++) {
        const ticks = archetype.ticks.get(queryMeta.changed[j]!);
        if (ticks) changedTickArrays.push(ticks.changed);
      }

      // Iterate entities backward (deletion-safe)
      entityLoop: for (let i = entities.length - 1; i >= 0; i--) {
        const entityId = entities[i]!;

        // Check added modifiers: skip if component wasn't added in (lastTick, tick] range
        for (let j = 0; j < addedTickArrays.length; j++) {
          const addedTick = addedTickArrays[j]![i]!;
          if (addedTick <= lastTick || addedTick > tick) {
            continue entityLoop;
          }
        }

        // Check changed modifiers: skip if component wasn't modified in (lastTick, tick] range
        for (let j = 0; j < changedTickArrays.length; j++) {
          const changedTick = changedTickArrays[j]![i]!;
          if (changedTick <= lastTick || changedTick > tick) {
            continue entityLoop;
          }
        }

        yield entityId;
      }
    }
  } finally {
    // Update lastTick after iteration completes (or on break/return/throw).
    // This ensures subsequent iterations only see changes since this execution.
    if (systemId === null) {
      queryMeta.lastTick.self = tick;
    } else {
      queryMeta.lastTick.bySystemId.set(systemId, tick);
    }
  }
}

/**
 * Destroy query and clean up associated resources.
 *
 * Unregisters observer callbacks and removes from query registry.
 *
 * @param world - World instance
 * @param queryMeta - Query metadata to destroy
 *
 * @example
 * ```typescript
 * const query = ensureQuery(world, Position);
 * // ... use query ...
 * destroyQuery(world, query);
 * ```
 */
export function destroyQuery(world: World, queryMeta: QueryMeta): void {
  const queryId = hashQuery(queryMeta.include, queryMeta.exclude, queryMeta.added, queryMeta.changed);

  unregisterObserverCallback(world, "filterDestroyed", queryMeta.onFilterDestroy);

  world.queries.byId.delete(queryId);
}

// ============================================================================
// Query Iteration
// ============================================================================

/**
 * Fetch entities matching components and modifiers.
 *
 * Iterates backward for safe entity destruction during iteration.
 * Creates/reuses cached query internally.
 *
 * @param world - World instance
 * @param terms - Component IDs and query modifiers (not, added, changed)
 * @returns Entity IDs in deletion-safe order
 *
 * @example
 * ```typescript
 * for (const entity of fetchEntities(world, Position, Velocity, not(Dead))) {
 *   const pos = get(world, entity, Position);
 *   // Entity can be safely destroyed here
 * }
 * ```
 */
export function* fetchEntities(world: World, ...terms: (EntityId | QueryModifier)[]): IterableIterator<EntityId> {
  const queryMeta = ensureQuery(world, ...terms);

  yield* fetchEntitiesWithQuery(world, queryMeta);
}

/**
 * Fetch first entity matching components and modifiers.
 *
 * Useful for singleton patterns or when only one match is expected.
 *
 * @param world - World instance
 * @param terms - Component IDs and query modifiers (not, added, changed)
 * @returns First matching entity ID, or undefined if no matches
 *
 * @example
 * ```typescript
 * const player = fetchFirstEntity(world, Player, not(Dead));
 * if (player !== undefined) {
 *   const health = get(world, player, Health);
 * }
 * ```
 */
export function fetchFirstEntity(world: World, ...terms: (EntityId | QueryModifier)[]): EntityId | undefined {
  const queryMeta = ensureQuery(world, ...terms);

  for (const entityId of fetchEntitiesWithQuery(world, queryMeta)) {
    return entityId;
  }

  return undefined;
}
