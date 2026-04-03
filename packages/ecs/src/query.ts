import type { FieldColumnsOf } from "./archetype.js";
import type { Component, EntityId, EntityWith, Pair, Relation } from "./encoding.js";
import { assert, InvalidArgument } from "./error.js";
import type { FilterMeta } from "./filters.js";
import { ensureFilter } from "./filters.js";
import type { World } from "./world.js";

// ============================================================================
// Query Metadata
// ============================================================================

/**
 * Phantom brand for carrying guaranteed-present component types on QueryMeta.
 */
declare const QUERY_COMPONENTS_BRAND: unique symbol;

/**
 * Phantom brand for carrying original query terms tuple on QueryMeta (covariant).
 */
declare const QUERY_TERMS_BRAND: unique symbol;

/**
 * Query metadata for registry caching.
 *
 * Stores required and excluded components with reference to underlying filter.
 */
export type QueryMeta<C extends EntityId = EntityId, T extends unknown[] = (EntityId | QueryModifier)[]> = {
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
   * Components with added() modifier.
   */
  added: EntityId[];

  /**
   * Components with changed() modifier.
   */
  changed: EntityId[];

  /**
   * Per-system execution ticks for change detection: systemId -> tick.
   */
  lastTick: Map<string, number>;

  /**
   * Phantom field carrying guaranteed-present component types via contravariance.
   */
  readonly [QUERY_COMPONENTS_BRAND]: (c: C) => void;

  /**
   * Phantom field carrying original query terms tuple (covariant).
   */
  readonly [QUERY_TERMS_BRAND]?: T;
};

// ============================================================================
// Query Modifiers
// ============================================================================

export type ModifierType = "not" | "added" | "changed";
export type NotModifier<C extends EntityId = EntityId> = { type: "not"; componentId: C };
export type AddedModifier<C extends EntityId = EntityId> = { type: "added"; componentId: C };
export type ChangedModifier<C extends EntityId = EntityId> = { type: "changed"; componentId: C };
export type QueryModifier = NotModifier | AddedModifier | ChangedModifier;

/**
 * Create exclusion modifier for query.
 *
 * @param componentId - Component to exclude from query results
 * @returns Not modifier
 *
 * @example
 * ```typescript
 * queryEntities(world, [Position, not(Dead)], (entity) => { ... });
 * ```
 */
export function not<C extends EntityId>(componentId: C): NotModifier<C> {
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
 * queryEntities(world, [added(Enemy)], (entity) => { ... });
 */
export function added<C extends EntityId>(componentId: C): AddedModifier<C> {
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
 * queryEntities(world, [changed(Health)], (entity) => { ... });
 */
export function changed<C extends EntityId>(componentId: C): ChangedModifier<C> {
  return { type: "changed", componentId };
}

/**
 * Extract union of guaranteed-present component IDs from query terms tuple.
 */
export type ExtractIncluded<T extends unknown[]> = T extends [infer Head, ...infer Tail]
  ? Head extends NotModifier
    ? ExtractIncluded<Tail>
    : Head extends AddedModifier<infer C>
      ? C | ExtractIncluded<Tail>
      : Head extends ChangedModifier<infer C>
        ? C | ExtractIncluded<Tail>
        : Head extends EntityId
          ? Head | ExtractIncluded<Tail>
          : ExtractIncluded<Tail>
  : never;

/**
 * Check if argument is a query modifier (not, added, changed) vs plain component ID.
 */
function isModifier(arg: unknown): arg is QueryModifier {
  return typeof arg === "object" && arg !== null && "type" in arg && "componentId" in arg;
}

// ============================================================================
// Column Query Types
// ============================================================================

/**
 * Map a query terms tuple to a tuple of field column types.
 *
 * Data-bearing terms (Components, Pairs with schema) produce a `FieldColumnsOf` entry.
 * Non-data terms (Tags, data-less Pairs, NotModifiers) are skipped.
 */
export type ColumnsTuple<T extends unknown[]> = T extends [infer Head, ...infer Tail]
  ? Head extends NotModifier
    ? ColumnsTuple<Tail>
    : Head extends Component<infer S>
      ? [FieldColumnsOf<S>, ...ColumnsTuple<Tail>]
      : Head extends Pair<infer R>
        ? R extends Relation<infer S>
          ? keyof S extends never
            ? ColumnsTuple<Tail>
            : [FieldColumnsOf<S>, ...ColumnsTuple<Tail>]
          : ColumnsTuple<Tail>
        : ColumnsTuple<Tail>
  : [];

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
 * Cache a query in the registry, creating if necessary.
 *
 * @param world - World instance
 * @param terms - Components and modifiers
 * @returns Query metadata
 * @throws {InvalidArgument} If no included components (query must match something)
 *
 * @example
 * const query = cacheQuery(world, [Position, Velocity, not(Dead)]);
 */
export function ensureQuery<T extends (EntityId | QueryModifier)[]>(
  world: World,
  terms: [...T]
): QueryMeta<ExtractIncluded<T>, T> {
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

  assert(filterInclude.length > 0, InvalidArgument, { expected: "at least one component in query" });

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
      lastTick: new Map(),
    } as QueryMeta;

    world.queries.byId.set(queryId, queryMeta);
  }

  return queryMeta as unknown as QueryMeta<ExtractIncluded<T>, T>;
}

// ============================================================================
// Query Iteration (Internal)
// ============================================================================

/**
 * Iterate entities using pre-registered query metadata via callback.
 */
function queryEntitiesWithMeta(world: World, queryMeta: QueryMeta, callback: (entity: EntityId) => unknown): void {
  const hasChangeModifiers = queryMeta.added.length > 0 || queryMeta.changed.length > 0;

  // Fast path: no change modifiers
  if (!hasChangeModifiers) {
    const archetypes = queryMeta.filter.archetypes;

    for (let a = 0; a < archetypes.length; a++) {
      const entities = archetypes[a]!.entities;
      for (let i = entities.length - 1; i >= 0; i--) {
        if (callback(entities[i]!) === false) {
          return;
        }
      }
    }

    return;
  }

  // Slow path: change detection requires system context
  const { systemId, tick } = world.execution;

  if (systemId === null) {
    return;
  }

  const lastTick = queryMeta.lastTick.get(systemId) ?? 0;
  const archetypes = queryMeta.filter.archetypes;

  // Pre-allocated arrays reused across archetypes to avoid allocation in hot loop
  const addedTickArrays: Uint32Array[] = [];
  const changedTickArrays: Uint32Array[] = [];

  // Use try/finally to ensure lastTick updates even on early exit
  try {
    for (let a = 0; a < archetypes.length; a++) {
      const archetype = archetypes[a]!;
      const entities = archetype.entities;

      // Pre-fetch tick arrays for this archetype
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

        if (callback(entityId) === false) {
          return;
        }
      }
    }
  } finally {
    // Update lastTick after iteration completes or on early exit, this ensures
    // subsequent iterations only see changes since this execution
    queryMeta.lastTick.set(systemId!, tick);
  }
}

/**
 * Resolve terms-or-query argument to QueryMeta.
 */
function resolveQuery(world: World, termsOrQuery: (EntityId | QueryModifier)[] | QueryMeta): QueryMeta {
  if (!Array.isArray(termsOrQuery)) {
    return termsOrQuery;
  }

  return ensureQuery(world, termsOrQuery) as QueryMeta;
}

// ============================================================================
// Query Iteration (Public)
// ============================================================================

/**
 * Iterate entities matching components and modifiers via callback.
 *
 * Iterates backward for safe entity destruction during iteration.
 * Creates/reuses cached query internally.
 *
 * @param world - World instance
 * @param termsOrQuery - Array of component IDs and query modifiers, or pre-built QueryMeta
 * @param callback - Called for each matching entity. Return `false` to stop iteration early
 *
 * @example
 * ```typescript
 * // With inline terms
 * queryEntities(world, [Position, Velocity, not(Dead)], (entity) => {
 *   const pos = getComponentValue(world, entity, Position, "x");
 * });
 *
 * // With pre-built query
 * const q = cacheQuery(world, [Position, Velocity]);
 * queryEntities(world, q, (entity) => { ... });
 *
 * // Early exit
 * queryEntities(world, [Position], (entity) => {
 *   if (done) return false;
 * });
 * ```
 */
export function queryEntities<T extends (EntityId | QueryModifier)[]>(
  world: World,
  terms: [...T],
  callback: (entity: EntityWith<ExtractIncluded<T>>) => unknown
): void;

export function queryEntities<C extends EntityId>(
  world: World,
  query: QueryMeta<C>,
  callback: (entity: EntityWith<C>) => unknown
): void;

export function queryEntities(
  world: World,
  termsOrQuery: (EntityId | QueryModifier)[] | QueryMeta,
  // biome-ignore lint/suspicious/noExplicitAny: implementation overload must be wider than public overloads
  callback: (entity: any) => unknown
): void {
  queryEntitiesWithMeta(world, resolveQuery(world, termsOrQuery), callback);
}

/**
 * Get first entity matching components and modifiers.
 *
 * Useful for singleton patterns or when only one match is expected.
 *
 * @param world - World instance
 * @param termsOrQuery - Array of component IDs and query modifiers, or pre-built QueryMeta
 * @returns First matching entity ID, or undefined if no matches
 *
 * @example
 * ```typescript
 * const player = queryFirstEntity(world, [Player, not(Dead)]);
 * if (player !== undefined) {
 *   const health = getComponentValue(world, player, Health, "value"); // narrowed
 * }
 * ```
 */
export function queryFirstEntity<T extends (EntityId | QueryModifier)[]>(
  world: World,
  terms: [...T]
): EntityWith<ExtractIncluded<T>> | undefined;

export function queryFirstEntity<C extends EntityId>(world: World, query: QueryMeta<C>): EntityWith<C> | undefined;

export function queryFirstEntity(
  world: World,
  termsOrQuery: (EntityId | QueryModifier)[] | QueryMeta
): EntityId | undefined {
  let result: EntityId | undefined;

  queryEntitiesWithMeta(world, resolveQuery(world, termsOrQuery), (entity) => {
    result = entity;
    return false;
  });

  return result;
}

/**
 * Collect all matching entities into an array.
 *
 * @param world - World instance
 * @param termsOrQuery - Array of component IDs and query modifiers, or pre-built QueryMeta
 * @returns Array of matching entity IDs
 *
 * @example
 * ```typescript
 * const entities = collectEntities(world, [Position, Velocity]);
 *
 * // Pre-sort before iteration
 * const sorted = collectEntities(world, [Position]);
 * sorted.sort((a, b) => getComponentValue(world, a, Position, "x")! - getComponentValue(world, b, Position, "x")!);
 * ```
 */
export function collectEntities<T extends (EntityId | QueryModifier)[]>(
  world: World,
  terms: [...T]
): EntityWith<ExtractIncluded<T>>[];

export function collectEntities<C extends EntityId>(world: World, query: QueryMeta<C>): EntityWith<C>[];

export function collectEntities(world: World, termsOrQuery: (EntityId | QueryModifier)[] | QueryMeta): EntityId[] {
  const result: EntityId[] = [];

  queryEntitiesWithMeta(world, resolveQuery(world, termsOrQuery), (entity) => {
    result.push(entity);
  });

  return result;
}

// ============================================================================
// Column Query Iteration
// ============================================================================

/**
 * Iterate matching archetypes with direct column access.
 *
 * Low-level query API that exposes raw storage arrays for high-performance iteration.
 * The callback fires once per matching archetype with the archetype's live entities
 * array and column parameters for each data-bearing term.
 *
 * Only `not()` modifiers are supported. `added()` and `changed()` are rejected —
 * use `queryEntities` for change detection.
 *
 * The `entities` array is the archetype's live backing store. If mutating
 * (destroying entities, adding/removing components) during iteration,
 * iterate backward to avoid skipping entities due to swap-and-pop.
 *
 * @param world - World instance
 * @param termsOrQuery - Array of component IDs and not() modifiers, or pre-built QueryMeta
 * @param callback - Called for each matching archetype. Return `false` to stop iteration
 *
 * @example
 * ```typescript
 * // Direct column access for high-performance iteration
 * queryColumns(world, [Position, Velocity, not(Dead)], (entities, [pos, vel]) => {
 *   for (let i = 0; i < entities.length; i++) {
 *     pos.x[i] += vel.x[i]!;
 *     pos.y[i] += vel.y[i]!;
 *   }
 * });
 *
 * // Pre-cached query
 * const q = cacheQuery(world, [Position, Velocity, not(Dead)]);
 * queryColumns(world, q, (entities, [pos, vel]) => { ... });
 *
 * // Mutation-safe backward iteration
 * queryColumns(world, [Position, Health], (entities, [pos, health]) => {
 *   for (let i = entities.length - 1; i >= 0; i--) {
 *     if (health.hp[i]! <= 0) {
 *       destroyEntity(world, entities[i]!);
 *     }
 *   }
 * });
 * ```
 */
export function queryColumns<T extends (EntityId | NotModifier)[]>(
  world: World,
  terms: [...T],
  callback: (entities: EntityId[], columns: ColumnsTuple<T>) => unknown
): void;

export function queryColumns<C extends EntityId, T extends unknown[]>(
  world: World,
  query: QueryMeta<C, T>,
  callback: (entities: EntityId[], columns: ColumnsTuple<T>) => unknown
): void;

export function queryColumns(
  world: World,
  termsOrQuery: (EntityId | QueryModifier)[] | QueryMeta,
  // biome-ignore lint/suspicious/noExplicitAny: implementation overload must be wider than public overloads
  callback: (entities: any, columns: any) => unknown
): void {
  const queryMeta = resolveQuery(world, termsOrQuery);

  assert(queryMeta.added.length === 0 && queryMeta.changed.length === 0, InvalidArgument, {
    expected: "queryColumns does not support added() or changed() modifiers",
  });

  const archetypes = queryMeta.filter.archetypes;
  const include = queryMeta.include;

  // Single allocation reused across all archetype iterations
  const columns: unknown[] = [];

  for (let a = 0; a < archetypes.length; a++) {
    const archetype = archetypes[a]!;

    if (archetype.entities.length === 0) {
      continue;
    }

    // Resolve columns for each included term. Tags and data-less pairs have
    // no entry in archetype.columns, so they are naturally skipped, and only
    // data-bearing components and pairs produce callback parameters
    columns.length = 0;

    for (let t = 0; t < include.length; t++) {
      const cols = archetype.columns.get(include[t]!);

      if (cols) {
        columns.push(cols);
      }
    }

    if (callback(archetype.entities, columns) === false) {
      return;
    }
  }
}
