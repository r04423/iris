import type { FieldColumnsOf } from "./archetype.js";
import type { Component, EntityId, EntityWith, Pair, Relation } from "./encoding.js";
import { assert, IrisInvalidArgument, IrisLimitExceeded } from "./error.js";
import type { FilterMeta, FilterTerms } from "./filters.js";
import { ensureFilter } from "./filters.js";
import type { World } from "./world.js";

/**
 * Maximum number of disjunctive filter branches a single query may expand to.
 */
const MAX_QUERY_BRANCHES = 32;

// ============================================================================
// Query Metadata
// ============================================================================

/**
 * Phantom brand for carrying guaranteed-present component types on Query.
 */
declare const QUERY_COMPONENTS_BRAND: unique symbol;

/**
 * Phantom brand for carrying original query terms tuple on Query (covariant).
 */
declare const QUERY_TERMS_BRAND: unique symbol;

/**
 * Query matching state stored by a world and shared by queries with the same terms.
 *
 * @example
 * ```typescript
 * const query = cacheQuery(world, [Position, Velocity]);
 * const meta = query.meta;
 * ```
 */
export type QueryMeta = {
  /**
   * Required component IDs.
   */
  include: EntityId[];

  /**
   * Excluded components.
   */
  exclude: EntityId[];

  /**
   * Underlying filter branches. Queries without or() terms have at most one.
   */
  filters: FilterMeta[];

  /**
   * Components with added() modifier.
   */
  added: EntityId[];

  /**
   * Components with changed() modifier.
   */
  changed: EntityId[];

  /**
   * Per-system observation revisions for change detection.
   */
  lastRevision: Map<string, number>;
};

/**
 * Query that preserves the caller's component order.
 *
 * @example
 * ```typescript
 * const movers = cacheQuery(world, [Position, Velocity]);
 * const entities = collectEntities(world, movers);
 * ```
 */
export type Query<C extends EntityId = never, T extends unknown[] = (EntityId | QueryModifier)[]> = {
  /**
   * Shared query matching state.
   */
  meta: QueryMeta;

  /**
   * Included component IDs in the order supplied by the caller.
   */
  requested: EntityId[];

  /**
   * Phantom field carrying guaranteed-present component types via contravariance.
   */
  readonly [QUERY_COMPONENTS_BRAND]: (c: C) => void;

  /**
   * Phantom field carrying original query terms tuple (covariant).
   */
  readonly [QUERY_TERMS_BRAND]?: T;
};

/**
 * Trie node for parametric query caching.
 *
 * @internal
 */
export type QueryTrieNode = {
  query?: Query;
  children?: Map<EntityId, QueryTrieNode>;
};

// ============================================================================
// Query Modifiers
// ============================================================================

export type ModifierType = "not" | "added" | "changed" | "or";
export type NotModifier<C extends EntityId = EntityId> = { type: "not"; componentId: C };
export type AddedModifier<C extends EntityId = EntityId> = { type: "added"; componentId: C };
export type ChangedModifier<C extends EntityId = EntityId> = { type: "changed"; componentId: C };
export type OrModifier<C extends EntityId = EntityId> = { type: "or"; componentIds: C[] };
export type QueryModifier = NotModifier | AddedModifier | ChangedModifier | OrModifier;

/**
 * Create exclusion modifier for query.
 *
 * @param componentId - Component to exclude from query results
 * @returns Not modifier
 *
 * @example
 * ```typescript
 * const living = collectEntities(world, [Position, not(Dead)]);
 * ```
 */
export function not<C extends EntityId>(componentId: C): NotModifier<C> {
  return { type: "not", componentId };
}

/**
 * Create added modifier for change detection.
 *
 * Matches additions in the consuming query's per-system revision window. See
 * `queryEntities` for window-consumption semantics.
 *
 * @param componentId - Component to check for addition
 * @returns Added modifier
 *
 * @example
 * const enemies = collectEntities(world, [added(Enemy)]);
 */
export function added<C extends EntityId>(componentId: C): AddedModifier<C> {
  return { type: "added", componentId };
}

/**
 * Create changed modifier for change detection.
 *
 * Matches modifications or additions in the consuming query's per-system
 * revision window. See `queryEntities` for window-consumption semantics.
 *
 * @param componentId - Component to check for changes
 * @returns Changed modifier
 *
 * @example
 * const damaged = collectEntities(world, [changed(Health)]);
 */
export function changed<C extends EntityId>(componentId: C): ChangedModifier<C> {
  return { type: "changed", componentId };
}

/**
 * Create disjunction modifier for query.
 *
 * Matches entities that have at least one of the given components.
 *
 * @param componentIds - Alternative components (at least one must be present)
 * @returns Or modifier
 *
 * @example
 * const moving = collectEntities(world, [Position, or(Velocity, Acceleration)]);
 */
export function or<C extends EntityId[]>(...componentIds: [...C]): OrModifier<C[number]> {
  assert(componentIds.length > 0, IrisInvalidArgument, { expected: "at least one component in or()" });

  return { type: "or", componentIds };
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
 * Check if argument is a query modifier (not, added, changed, or) vs plain component ID.
 */
function isModifier(arg: unknown): arg is QueryModifier {
  return typeof arg === "object" && arg !== null && "type" in arg;
}

// ============================================================================
// Column Query Types
// ============================================================================

/**
 * Map a query terms tuple to a tuple of field column types.
 *
 * Data-bearing terms (Components, Pairs with schema) produce a `FieldColumnsOf` entry.
 * Non-data terms (Tags, data-less Pairs, NotModifiers, OrModifiers) are skipped.
 *
 * @experimental Associated with the experimental live-column traversal API.
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
 * @param orGroups - Groups of alternative component IDs (one per or() term)
 * @returns Query ID in format "+include|-exclude|~+added|~>changed" with an
 *   "|vA:B,C:D" segment appended when or() groups are present
 *
 * @example
 * ```typescript
 * const id = hashQuery([Position, Velocity], [Dead], [], []);
 * ```
 */
export function hashQuery(
  include: EntityId[],
  exclude: EntityId[],
  added: EntityId[],
  changed: EntityId[],
  orGroups: EntityId[][] = []
): string {
  // Sort to ensure consistent hashing regardless of term order
  const join = (arr: EntityId[]) => arr.toSorted((a, b) => a - b).join(":");

  const hash = `+${join(include)}|-${join(exclude)}|~+${join(added)}|~>${join(changed)}`;

  if (orGroups.length === 0) {
    return hash;
  }

  // Groups hash independently to preserve boundaries: or(A,B)+or(C,D) must
  // differ from or(A,C)+or(B,D) despite containing the same four IDs
  const orHash = orGroups
    .map((group) => join(group))
    .toSorted()
    .join(",");

  return `${hash}|v${orHash}`;
}

// ============================================================================
// Query Registry Operations
// ============================================================================

/**
 * Cache a query in the registry, creating if necessary.
 *
 * @param world - World instance
 * @param terms - Components and modifiers
 * @returns Query with the requested component order
 * @throws {IrisInvalidArgument} If no included components (query must match something)
 *
 * @example
 * const query = cacheQuery(world, [Position, Velocity, not(Dead)]);
 */
export function ensureQuery<T extends (EntityId | QueryModifier)[]>(
  world: World,
  terms: [...T]
): Query<ExtractIncluded<T>, T> {
  const include: EntityId[] = [];
  const exclude: EntityId[] = [];
  const added: EntityId[] = [];
  const changed: EntityId[] = [];
  const orGroups: EntityId[][] = [];

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
        case "or":
          // Sort and remove duplicate alternatives so order does not affect query lookup
          orGroups.push([...new Set(term.componentIds)].sort((a, b) => a - b));
          break;
      }
    } else {
      include.push(term);
    }
  }

  // Filter must include added/changed components since they must be present on entity
  const filterInclude = include.concat(added, changed);

  assert(filterInclude.length > 0 || orGroups.length > 0, IrisInvalidArgument, {
    expected: "at least one component in query",
  });

  const queryId = hashQuery(include, exclude, added, changed, orGroups);

  let queryMeta = world.queries.byId.get(queryId);

  if (!queryMeta) {
    queryMeta = {
      include,
      exclude,
      added,
      changed,
      filters: buildQueryFilters(world, filterInclude, exclude, orGroups),
      lastRevision: new Map(),
    };

    world.queries.byId.set(queryId, queryMeta);
  }

  return { meta: queryMeta, requested: include } as Query<ExtractIncluded<T>, T>;
}

/**
 * Expand query terms into disjoint conjunctive filter branches.
 *
 * Each or() group contributes one branch per alternative; multiple groups
 * multiply (cartesian product).
 *
 * Each branch is an ordinary filter that flows through the existing
 * ensureFilter cache and archetype dispatch.
 *
 * @internal
 */
function buildQueryFilters(
  world: World,
  include: EntityId[],
  exclude: EntityId[],
  orGroups: EntityId[][]
): FilterMeta[] {
  let branches: FilterTerms[] = [{ include, exclude }];

  for (let g = 0; g < orGroups.length; g++) {
    const group = orGroups[g]!;

    // Group already satisfied by a guaranteed-present component - skip it
    if (group.some((id) => include.includes(id))) {
      continue;
    }

    const next: FilterTerms[] = [];

    for (let b = 0; b < branches.length; b++) {
      const branch = branches[b]!;

      for (let i = 0; i < group.length; i++) {
        next.push({
          include: branch.include.concat(group[i]!),
          exclude: branch.exclude.concat(group.slice(0, i)),
        });
      }
    }

    branches = next;
  }

  assert(branches.length <= MAX_QUERY_BRANCHES, IrisLimitExceeded, {
    resource: "Query filter branches",
    max: MAX_QUERY_BRANCHES,
  });

  const filters: FilterMeta[] = [];

  for (let b = 0; b < branches.length; b++) {
    const branch = branches[b]!;

    // Prune contradictory branches (an included component is also excluded);
    // they can never match, so registering them would only waste cache entries
    if (branch.include.some((id) => branch.exclude.includes(id))) {
      continue;
    }

    // Dedupe exclusions: a synthesized alternative exclusion may repeat a user
    // not() term, and duplicates would fragment the filter cache by hash
    filters.push(ensureFilter(world, { include: branch.include, exclude: [...new Set(branch.exclude)] }));
  }

  return filters;
}

/**
 * Create a cached parametric query getter.
 *
 * @internal
 */
export function ensureQueryGetter(
  world: World,
  builder: (...args: EntityId[]) => (EntityId | QueryModifier)[]
): (...args: EntityId[]) => Query {
  return (...args: EntityId[]): Query => {
    let node: QueryTrieNode;

    const root = world.queries.byBuilder.get(builder);

    if (!root) {
      node = {};
      world.queries.byBuilder.set(builder, node);
    } else {
      node = root;
    }

    for (let i = 0; i < args.length; i++) {
      let children: Map<EntityId, QueryTrieNode> | undefined = node.children;

      if (!children) {
        children = new Map();
        node.children = children;
      }

      let next: QueryTrieNode | undefined = children.get(args[i]!);

      if (!next) {
        next = {};
        children.set(args[i]!, next);
      }

      node = next;
    }

    let query = node.query;

    if (!query) {
      query = ensureQuery(world, builder(...args));
      node.query = query;
    }

    return query;
  };
}

/**
 * Cache a static query or create a cached parametric query getter.
 *
 * Parametric builders must be pure and return the same term structure for the
 * same arguments. Create getters once: builder identity owns the cache. Pair
 * targets use generation-stripped weak-reference semantics. Change detection
 * windows are tracked independently for each system and argument tuple.
 *
 * @param world - World instance
 * @param builder - Entity arguments to query terms builder
 * @returns Cached query getter
 *
 * @example
 * ```typescript
 * const childrenOf = cacheQuery(world, (parent: EntityId) => [pair(ChildOf, parent)]);
 * const children = collectEntities(world, childrenOf(root));
 * ```
 */
export function cacheQuery<A extends EntityId[], const T extends (EntityId | QueryModifier)[]>(
  world: World,
  builder: (...args: [...A]) => T
): (...args: [...A]) => Query<ExtractIncluded<T>, T>;

/**
 * Cache a query in the registry, creating it if necessary.
 *
 * @param world - World instance
 * @param terms - Components and modifiers
 * @returns Cached query
 *
 * @example
 * ```typescript
 * const movers = cacheQuery(world, [Position, Velocity, not(Dead)]);
 * ```
 */
export function cacheQuery<T extends (EntityId | QueryModifier)[]>(
  world: World,
  terms: [...T]
): Query<ExtractIncluded<T>, T>;

export function cacheQuery(
  world: World,
  termsOrBuilder: (EntityId | QueryModifier)[] | ((...args: EntityId[]) => (EntityId | QueryModifier)[])
): Query<never> | ((...args: EntityId[]) => Query<never>) {
  if (typeof termsOrBuilder === "function") {
    return ensureQueryGetter(world, termsOrBuilder);
  }

  return ensureQuery(world, termsOrBuilder);
}

// ============================================================================
// Query Iteration (Internal)
// ============================================================================

/**
 * Iterate entities using pre-registered query metadata via callback.
 */
function queryEntitiesWithMeta(world: World, queryMeta: QueryMeta, callback: (entity: EntityId) => unknown): void {
  const hasChangeModifiers = queryMeta.added.length > 0 || queryMeta.changed.length > 0;
  const filters = queryMeta.filters;

  // Fast path: no change modifiers
  if (!hasChangeModifiers) {
    for (let f = 0; f < filters.length; f++) {
      const archetypes = filters[f]!.archetypes;

      for (let a = 0; a < archetypes.length; a++) {
        const entities = archetypes[a]!.entities;

        for (let i = entities.length - 1; i >= 0; i--) {
          if (callback(entities[i]!) === false) {
            return;
          }
        }
      }
    }

    return;
  }

  // Slow path: change detection requires system context
  const { systemId } = world.execution;

  if (systemId === null) {
    return;
  }

  const boundary = world.revision;
  const lastRevision = queryMeta.lastRevision.get(systemId) ?? 0;

  assert(boundary < Number.MAX_SAFE_INTEGER, IrisLimitExceeded, {
    resource: "World revision",
    max: Number.MAX_SAFE_INTEGER,
  });

  queryMeta.lastRevision.set(systemId, boundary);
  world.revision = boundary + 1;

  // Pre-allocated arrays reused across archetypes to avoid allocation in hot loop
  const addedRevisionArrays: Float64Array[] = [];
  const changedRevisionArrays: Float64Array[] = [];

  for (let f = 0; f < filters.length; f++) {
    const archetypes = filters[f]!.archetypes;

    for (let a = 0; a < archetypes.length; a++) {
      const archetype = archetypes[a]!;
      const entities = archetype.entities;

      // Pre-fetch revision arrays for this archetype
      addedRevisionArrays.length = 0;

      for (let j = 0; j < queryMeta.added.length; j++) {
        const ticks = archetype.ticks.get(queryMeta.added[j]!);

        if (ticks) {
          addedRevisionArrays.push(ticks.added);
        }
      }

      changedRevisionArrays.length = 0;

      for (let j = 0; j < queryMeta.changed.length; j++) {
        const ticks = archetype.ticks.get(queryMeta.changed[j]!);

        if (ticks) {
          changedRevisionArrays.push(ticks.changed);
        }
      }

      // Iterate entities backward (deletion-safe)
      entityLoop: for (let i = entities.length - 1; i >= 0; i--) {
        const entityId = entities[i]!;

        // Check added modifiers against the captured (lastRevision, boundary] window
        for (let j = 0; j < addedRevisionArrays.length; j++) {
          const addedRevision = addedRevisionArrays[j]![i]!;

          if (addedRevision <= lastRevision || addedRevision > boundary) {
            continue entityLoop;
          }
        }

        // Check changed modifiers against the captured (lastRevision, boundary] window
        for (let j = 0; j < changedRevisionArrays.length; j++) {
          const changedRevision = changedRevisionArrays[j]![i]!;

          if (changedRevision <= lastRevision || changedRevision > boundary) {
            continue entityLoop;
          }
        }

        if (callback(entityId) === false) {
          return;
        }
      }
    }
  }
}

/**
 * Resolve terms-or-query argument to Query.
 */
function resolveQuery(world: World, termsOrQuery: (EntityId | QueryModifier)[] | Query): Query {
  if (!Array.isArray(termsOrQuery)) {
    return termsOrQuery;
  }

  return ensureQuery(world, termsOrQuery);
}

// ============================================================================
// Query Iteration
// ============================================================================

/**
 * Iterate entities matching components and modifiers via callback.
 *
 * Traverses live archetype storage. Structural world mutation during the
 * callback is unsupported: it can duplicate or skip visits, or prevent
 * traversal from terminating. Use `collectEntities()` before structural
 * mutation.
 *
 * @param world - World instance
 * @param termsOrQuery - Array of component IDs and query modifiers, or pre-built Query
 * @param callback - Called for each matching entity. Return `false` to stop iteration early
 * @experimental This API may change or be removed without notice.
 */
export function queryEntities<T extends (EntityId | QueryModifier)[]>(
  world: World,
  terms: [...T],
  callback: (entity: EntityWith<ExtractIncluded<T>>) => unknown
): void;

export function queryEntities<C extends EntityId>(
  world: World,
  query: Query<C>,
  callback: (entity: EntityWith<C>) => unknown
): void;

export function queryEntities(
  world: World,
  termsOrQuery: (EntityId | QueryModifier)[] | Query,
  // biome-ignore lint/suspicious/noExplicitAny: implementation overload must be wider than public overloads
  callback: (entity: any) => unknown
): void {
  queryEntitiesWithMeta(world, resolveQuery(world, termsOrQuery).meta, callback);
}

/**
 * Get first entity matching components and modifiers.
 *
 * Useful for singleton patterns or when only one match is expected.
 *
 * @param world - World instance
 * @param termsOrQuery - Array of component IDs and query modifiers, or pre-built Query
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

export function queryFirstEntity<C extends EntityId>(world: World, query: Query<C>): EntityWith<C> | undefined;

export function queryFirstEntity(
  world: World,
  termsOrQuery: (EntityId | QueryModifier)[] | Query
): EntityId | undefined {
  let result: EntityId | undefined;

  queryEntitiesWithMeta(world, resolveQuery(world, termsOrQuery).meta, (entity) => {
    result = entity;
    return false;
  });

  return result;
}

/**
 * Collect all matching entities into an array.
 *
 * @param world - World instance
 * @param termsOrQuery - Array of component IDs and query modifiers, or pre-built Query
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

export function collectEntities<C extends EntityId>(world: World, query: Query<C>): EntityWith<C>[];

export function collectEntities(world: World, termsOrQuery: (EntityId | QueryModifier)[] | Query): EntityId[] {
  const result: EntityId[] = [];

  queryEntitiesWithMeta(world, resolveQuery(world, termsOrQuery).meta, (entity) => {
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
 * Only `not()` and `or()` modifiers are supported. `added()` and `changed()` are
 * rejected; use `collectEntities` for change detection. Or'd components produce
 * no columns since they are not guaranteed present in every matching archetype.
 *
 * The entities and columns are borrowed live backing stores. Do not retain or
 * mutate the entities array, or structurally mutate the world during the
 * callback.
 *
 * @param world - World instance
 * @param termsOrQuery - Array of component IDs and not() modifiers, or pre-built Query
 * @param callback - Called for each matching archetype. Return `false` to stop iteration
 * @experimental This API may change or be removed without notice.
 */
export function queryColumns<T extends (EntityId | NotModifier | OrModifier)[]>(
  world: World,
  terms: [...T],
  callback: (entities: EntityId[], columns: ColumnsTuple<T>) => unknown
): void;

export function queryColumns<C extends EntityId, T extends unknown[]>(
  world: World,
  query: Query<C, T>,
  callback: (entities: EntityId[], columns: ColumnsTuple<T>) => unknown
): void;

export function queryColumns(
  world: World,
  termsOrQuery: (EntityId | QueryModifier)[] | Query,
  // biome-ignore lint/suspicious/noExplicitAny: implementation overload must be wider than public overloads
  callback: (entities: any, columns: any) => unknown
): void {
  const query = resolveQuery(world, termsOrQuery);
  const queryMeta = query.meta;

  assert(queryMeta.added.length === 0 && queryMeta.changed.length === 0, IrisInvalidArgument, {
    expected: "queryColumns does not support added() or changed() modifiers",
  });

  const filters = queryMeta.filters;
  const requested = query.requested;

  // Single allocation reused across all archetype iterations
  const columns: unknown[] = [];

  for (let f = 0; f < filters.length; f++) {
    const archetypes = filters[f]!.archetypes;

    for (let a = 0; a < archetypes.length; a++) {
      const archetype = archetypes[a]!;

      if (archetype.entities.length === 0) {
        continue;
      }

      // Resolve columns for each requested term. Tags and data-less pairs have
      // no entry in archetype.columns, so they are naturally skipped, and only
      // data-bearing components and pairs produce callback parameters. Or'd
      // components never enter requested, so column positions stay aligned
      // across all filter branches
      columns.length = 0;

      for (let t = 0; t < requested.length; t++) {
        const cols = archetype.columns.get(requested[t]!);

        if (cols) {
          columns.push(cols);
        }
      }

      if (callback(archetype.entities, columns) === false) {
        return;
      }
    }
  }
}
