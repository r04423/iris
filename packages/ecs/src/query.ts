import type { FieldColumnsOf } from "./archetype.js";
import type { Component, EntityId, EntityWith, Pair, Relation } from "./encoding.js";
import { IrisInvalidQuery, IrisQueryLimitExceeded } from "./error.js";
import type { FilterMeta, FilterTerms } from "./filters.js";
import { ensureFilter } from "./filters.js";
import { consumeRevisionWindow, inRevisionWindow } from "./revision.js";
import type { SchemaRecord } from "./schema.js";
import type { World } from "./world.js";

/**
 * Maximum number of disjunctive filter branches a single query may expand to.
 */
const MAX_QUERY_BRANCHES = 32;

/**
 * Terminates an or() group in the term trie so its alternatives cannot alias
 * following query terms.
 */
const OR_GROUP_END = Symbol("orGroupEnd");

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
  /** Required component IDs. */
  include: EntityId[];
  /** Excluded components. */
  exclude: EntityId[];
  /** Underlying filter branches. Queries without or() terms have at most one. */
  filters: FilterMeta[];
  /** Components with added() modifier. */
  added: EntityId[];
  /** Components with changed() modifier. */
  changed: EntityId[];
  /** Per-system observation revisions for change detection. */
  lastRevision: Map<string, number>;
};

/**
 * Cached query handle preserving the caller's component order.
 *
 * Created by {@link cacheQuery} and accepted anywhere terms are: matching
 * entities carry type narrowing for the components the query guarantees.
 *
 * @example
 * ```typescript
 * const movers = cacheQuery(world, [Position, Velocity]);
 * const entities = collectEntities(world, movers);
 * ```
 */
export type Query<C extends EntityId = never, T extends unknown[] = (EntityId | QueryModifier)[]> = {
  /** Shared query matching state. */
  meta: QueryMeta;
  /** Included component IDs in the order supplied by the caller. */
  requested: EntityId[];
  /** Phantom field carrying guaranteed-present component types via contravariance. */
  readonly [QUERY_COMPONENTS_BRAND]: (c: C) => void;
  /** Phantom field carrying original query terms tuple (covariant). */
  readonly [QUERY_TERMS_BRAND]?: T;
};

/**
 * Trie node for term and parametric query caching.
 *
 * @internal
 */
export type QueryTrieNode = {
  query?: Query;
  children?: Map<EntityId | ModifierType | typeof OR_GROUP_END, QueryTrieNode>;
};

// ============================================================================
// Query State
// ============================================================================

/**
 * Query registry: ordered term queries, metadata by hash, and parametric getters.
 * @internal
 */
export type QueryState = {
  /** Query handles keyed by their exact term sequence. */
  byTerms: QueryTrieNode;
  /** Query metadata lookup (query hash -> metadata). */
  byId: Map<string, QueryMeta>;
  /** Parametric query caches keyed by builder function identity. */
  byBuilder: Map<(...args: EntityId[]) => (EntityId | QueryModifier)[], QueryTrieNode>;
};

/**
 * Creates an empty query registry.
 * @internal
 */
export function createQueryState(): QueryState {
  return {
    byTerms: {},
    byId: new Map(),
    byBuilder: new Map(),
  };
}

/**
 * Clears the world's cached queries.
 * @internal
 */
export function resetQueryState(world: World): void {
  world.queries.byTerms = {};
  world.queries.byId.clear();
  world.queries.byBuilder.clear();
}

// ============================================================================
// Query Modifiers
// ============================================================================

/**
 * Discriminant tag distinguishing the query modifier kinds.
 */
export type ModifierType = "not" | "added" | "changed" | "or";

/**
 * Query term excluding entities that have the component. Created by {@link not}.
 */
export type NotModifier<C extends EntityId = EntityId> = { type: "not"; componentId: C };

/**
 * Change-detection term matching recently added components. Created by {@link added}.
 */
export type AddedModifier<C extends EntityId = EntityId> = { type: "added"; componentId: C };

/**
 * Change-detection term matching recently written components. Created by {@link changed}.
 */
export type ChangedModifier<C extends EntityId = EntityId> = { type: "changed"; componentId: C };

/**
 * Query term matching entities with at least one of the alternatives. Created by {@link or}.
 */
export type OrModifier<C extends EntityId = EntityId> = { type: "or"; componentIds: C[] };

/**
 * Union of all modifier terms accepted alongside component IDs in query terms.
 */
export type QueryModifier = NotModifier | AddedModifier | ChangedModifier | OrModifier;

/**
 * Creates a query term that excludes entities having the component.
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
 * Creates a change-detection term matching entities whose component was added
 * since the querying system last read this query.
 *
 * The component must still be present to match. Only produces results inside
 * system execution -- outside a system the query matches nothing. Each read
 * consumes the window whole; see {@link collectEntities}.
 *
 * @example
 * ```typescript
 * addSystem(world, function spawnAlert() {
 *   const spawned = collectEntities(world, [added(Player)]);
 * });
 * ```
 */
export function added<C extends EntityId>(componentId: C): AddedModifier<C> {
  return { type: "added", componentId };
}

/**
 * Creates a change-detection term matching entities whose component was
 * written or added since the querying system last read this query.
 *
 * The component must still be present to match. Only produces results inside
 * system execution -- outside a system the query matches nothing. Each read
 * consumes the window whole; see {@link collectEntities}.
 *
 * @example
 * ```typescript
 * addSystem(world, function healthReport() {
 *   const damaged = collectEntities(world, [changed(Health)]);
 * });
 * ```
 */
export function changed<C extends EntityId>(componentId: C): ChangedModifier<C> {
  return { type: "changed", componentId };
}

/**
 * Creates a query term matching entities that have at least one of the given
 * components.
 *
 * A match proves no specific alternative present, so `or()` terms do not
 * narrow the entity type. Alternatives multiply across groups: a query's
 * `or()` groups are capped at 32 combinations.
 *
 * @throws {IrisInvalidQuery} If called with no components
 *
 * @example
 * ```typescript
 * const active = collectEntities(world, [Position, or(Velocity, Health)]);
 * ```
 */
export function or<C extends EntityId[]>(...componentIds: [...C]): OrModifier<C[number]> {
  if (componentIds.length === 0) {
    throw new IrisInvalidQuery("at least one component in or()");
  }

  return { type: "or", componentIds };
}

/**
 * Extract union of guaranteed-present component IDs from query terms tuple.
 *
 * Only terms a match proves present may be extracted -- the union feeds
 * `EntityWith`, which suppresses the `undefined` return of a missing component.
 */
export type ExtractIncluded<T extends unknown[]> = T extends [infer Head, ...infer Tail]
  ? Head extends NotModifier
    ? ExtractIncluded<Tail>
    : // Change modifiers still require the component, so unwrap it
      Head extends AddedModifier<infer C>
      ? C | ExtractIncluded<Tail>
      : Head extends ChangedModifier<infer C>
        ? C | ExtractIncluded<Tail>
        : Head extends EntityId
          ? Head | ExtractIncluded<Tail>
          : // or() proves only that one branch matched, never which
            ExtractIncluded<Tail>
  : never;

/**
 * Distinguishes a query modifier from a plain component ID.
 */
function isModifier(arg: unknown): arg is QueryModifier {
  return typeof arg === "object" && arg !== null && "type" in arg;
}

// ============================================================================
// Column Query Types
// ============================================================================

/**
 * Maps a query terms tuple to the tuple of column objects a `queryColumns`
 * callback receives.
 *
 * Only data-bearing terms produce an entry: tags, `not()`/`or()` terms,
 * schema-less pairs, and wildcard pairs are skipped. The skips below must stay
 * in step with the runtime term-skipping in `queryColumns`, or callback
 * parameters silently shift left.
 *
 * @experimental Exported as `EXPERIMENTAL_ColumnsTuple`; may change or be removed.
 */
export type ColumnsTuple<T extends unknown[]> = T extends [infer Head, ...infer Tail]
  ? // Excluded from matching archetypes, so never stored
    Head extends NotModifier
    ? ColumnsTuple<Tail>
    : // Components always carry a schema
      Head extends Component<infer S>
      ? [FieldColumnsOf<S>, ...ColumnsTuple<Tail>]
      : Head extends Pair<infer R, infer Target>
        ? // Archetypes store concrete pairs, and one can hold several targets for the
          // same relation, so no single column answers to a wildcard term
          Target extends Relation<SchemaRecord, "Wildcard">
          ? ColumnsTuple<Tail>
          : R extends Relation<infer S>
            ? // A schema-less relation types as `Record<string, never>`, whose keyof
              // is `string` -- that wide key marks the pair as data-less
              string extends keyof S
              ? ColumnsTuple<Tail>
              : [FieldColumnsOf<S>, ...ColumnsTuple<Tail>]
            : ColumnsTuple<Tail>
        : // Tags, or() groups, and bare entity IDs have no columns
          ColumnsTuple<Tail>
  : [];

// ============================================================================
// Query Hashing
// ============================================================================

/**
 * Hashes categorized query terms into the registry key
 * ("+include|-exclude|~+added|~>changed", plus "|v..." for or() groups).
 * Sorting makes the key order-independent.
 * @internal
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
 * Gets or creates a query for the exact term sequence.
 * @internal
 */
export function ensureQuery<T extends (EntityId | QueryModifier)[]>(
  world: World,
  terms: [...T]
): Query<ExtractIncluded<T>, T> {
  let node = world.queries.byTerms;

  for (let i = 0; i < terms.length; i++) {
    const term = terms[i]!;

    if (!isModifier(term)) {
      node = ensureQueryTrieChild(node, term);
      continue;
    }

    node = ensureQueryTrieChild(node, term.type);

    if (term.type === "or") {
      for (let a = 0; a < term.componentIds.length; a++) {
        node = ensureQueryTrieChild(node, term.componentIds[a]!);
      }

      node = ensureQueryTrieChild(node, OR_GROUP_END);
    } else {
      node = ensureQueryTrieChild(node, term.componentId);
    }
  }

  if (!node.query) {
    node.query = createQuery(world, terms);
  }

  return node.query as Query<ExtractIncluded<T>, T>;
}

/**
 * Gets or creates a child node for one encoded query value.
 */
function ensureQueryTrieChild(node: QueryTrieNode, key: EntityId | ModifierType | typeof OR_GROUP_END): QueryTrieNode {
  let children = node.children;

  if (!children) {
    children = new Map();
    node.children = children;
  }

  let child = children.get(key);

  if (!child) {
    child = {};
    children.set(key, child);
  }

  return child;
}

/**
 * Resolves an uncached term sequence while sharing order-independent metadata.
 */
function createQuery<T extends (EntityId | QueryModifier)[]>(
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

  if (filterInclude.length === 0 && orGroups.length === 0) {
    throw new IrisInvalidQuery("at least one component in query");
  }

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
 * Expands query terms into disjoint conjunctive filter branches: each or()
 * group multiplies branches, one per alternative, with earlier alternatives
 * excluded so no archetype matches two branches (no double visits). Each
 * branch flows through the ordinary ensureFilter cache and dispatch.
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

  if (branches.length > MAX_QUERY_BRANCHES) {
    throw new IrisQueryLimitExceeded(MAX_QUERY_BRANCHES);
  }

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
 * Creates a parametric query getter caching one Query per argument tuple in a
 * trie keyed by builder identity.
 * @internal
 */
export function ensureQueryGetter(
  world: World,
  builder: (...args: EntityId[]) => (EntityId | QueryModifier)[]
): (...args: EntityId[]) => Query {
  return (...args: EntityId[]): Query => {
    let node: QueryTrieNode;

    // Root node per builder function
    const root = world.queries.byBuilder.get(builder);

    if (!root) {
      node = {};
      world.queries.byBuilder.set(builder, node);
    } else {
      node = root;
    }

    // Walk one trie level per argument, creating nodes on first visit
    for (let i = 0; i < args.length; i++) {
      let children = node.children;

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

    // Leaf holds the query; the builder runs only on the first lookup
    let query = node.query;

    if (!query) {
      query = ensureQuery(world, builder(...args));
      node.query = query;
    }

    return query;
  };
}

/**
 * Caches a query from terms, or creates a cached parametric query getter from
 * a builder function.
 *
 * Builders must be pure -- same arguments, same terms -- and their terms are
 * validated on the getter's first call per argument tuple. Create getters
 * once and reuse them: the cache is keyed by builder identity. A query holds
 * its pair targets weakly: destroying a target does not evict the query, it
 * simply matches nothing until the pair is re-established. Change detection
 * windows are tracked independently per system and per argument tuple.
 * Consume the result with {@link collectEntities}.
 *
 * @throws {IrisInvalidQuery} If no term guarantees a component's presence
 * @throws {IrisQueryLimitExceeded} If or() groups expand past 32 combinations
 *
 * @example
 * ```typescript
 * const movers = cacheQuery(world, [Position, Velocity, not(Dead)]);
 *
 * const childrenOf = cacheQuery(world, (parent: EntityId) => [pair(ChildOf, parent)]);
 * const children = collectEntities(world, childrenOf(parent));
 * ```
 */
export function cacheQuery<A extends EntityId[], const T extends (EntityId | QueryModifier)[]>(
  world: World,
  builder: (...args: [...A]) => T
): (...args: [...A]) => Query<ExtractIncluded<T>, T>;

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
 * Iterates entities matching cached query metadata via callback.
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

  // Consume the window up front: stopping early still discards the remainder
  const boundary = world.revision;
  const lastRevision = consumeRevisionWindow(world, queryMeta.lastRevision, systemId, boundary);

  // Pre-allocated arrays reused across archetypes to avoid allocation in hot loop
  const addedRevisionArrays: Float64Array[] = [];
  const changedRevisionArrays: Float64Array[] = [];

  for (let f = 0; f < filters.length; f++) {
    const archetypes = filters[f]!.archetypes;

    archetypeLoop: for (let a = 0; a < archetypes.length; a++) {
      const archetype = archetypes[a]!;
      const entities = archetype.entities;

      // Pre-fetch revision arrays for this archetype. When a term's max stamp
      // sits at or before the window start, no row can satisfy that term, so
      // the whole archetype is skipped
      addedRevisionArrays.length = 0;

      for (let j = 0; j < queryMeta.added.length; j++) {
        const ticks = archetype.ticks.get(queryMeta.added[j]!);

        if (ticks) {
          if (ticks.maxAdded <= lastRevision) {
            continue archetypeLoop;
          }

          addedRevisionArrays.push(ticks.added);
        }
      }

      changedRevisionArrays.length = 0;

      for (let j = 0; j < queryMeta.changed.length; j++) {
        const ticks = archetype.ticks.get(queryMeta.changed[j]!);

        if (ticks) {
          if (ticks.maxChanged <= lastRevision) {
            continue archetypeLoop;
          }

          changedRevisionArrays.push(ticks.changed);
        }
      }

      // Iterate entities backward (deletion-safe)
      entityLoop: for (let i = entities.length - 1; i >= 0; i--) {
        const entityId = entities[i]!;

        // Check added modifiers against the captured (lastRevision, boundary] window
        for (let j = 0; j < addedRevisionArrays.length; j++) {
          if (!inRevisionWindow(addedRevisionArrays[j]![i]!, lastRevision, boundary)) {
            continue entityLoop;
          }
        }

        // Check changed modifiers against the captured (lastRevision, boundary] window
        for (let j = 0; j < changedRevisionArrays.length; j++) {
          if (!inRevisionWindow(changedRevisionArrays[j]![i]!, lastRevision, boundary)) {
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
 * Resolves a terms-or-query argument to a Query.
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
 * Iterates entities matching components and modifiers via callback.
 *
 * Traverses live archetype storage. Structural world mutation during the
 * callback is unsupported: it can duplicate or skip visits, or prevent
 * traversal from terminating. Use {@link collectEntities} before structural
 * mutation. `added()`/`changed()` terms read a per-system revision window,
 * and the read consumes it whole -- a second read returns nothing, and
 * stopping early discards the rest. Experimental: exported as
 * `EXPERIMENTAL_queryEntities`.
 *
 * @param callback - Called for each matching entity; return `false` to stop early
 * @throws {IrisInvalidQuery} If no term guarantees a component's presence
 *
 * @example
 * ```typescript
 * EXPERIMENTAL_queryEntities(world, [Position, Velocity], (entity) => {
 *   const x = getComponentValue(world, entity, Position, "x");
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
 * Returns the first entity matching components and modifiers, or undefined.
 *
 * Match order is unspecified -- intended for singleton patterns where at most
 * one entity matches. A defined result is narrowed for the typed accessors
 * like {@link getComponentValue}.
 *
 * @throws {IrisInvalidQuery} If no term guarantees a component's presence
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
 * Collects all matching entities into a new array.
 *
 * The snapshot is safe to sort, retain, and iterate while structurally
 * mutating the world. `added()`/`changed()` terms only produce results inside
 * system execution, and each read consumes the per-system change window
 * whole -- a second read in the same run returns nothing.
 *
 * @throws {IrisInvalidQuery} If no term guarantees a component's presence
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
 * Iterates matching archetypes with direct column access.
 *
 * The callback fires once per non-empty matching archetype with the
 * archetype's live entities array and one column object per data-bearing
 * term -- tags, schema-less pairs, wildcard pairs, and `or()` alternatives
 * produce no parameter. Entities and columns are borrowed live backing
 * stores: do not retain or mutate the entities array, or structurally mutate
 * the world during the callback. Only `not()` and `or()` modifiers are
 * supported; use {@link collectEntities} for change detection. Experimental:
 * exported as `EXPERIMENTAL_queryColumns`.
 *
 * @param callback - Called for each matching archetype; return `false` to stop early
 * @throws {IrisInvalidQuery} If terms contain added() or changed(), or no term
 *   guarantees a component's presence
 *
 * @example
 * ```typescript
 * EXPERIMENTAL_queryColumns(world, [Position, Velocity], (entities, [position, velocity]) => {
 *   for (let i = 0; i < entities.length; i++) {
 *     position.x[i] += velocity.vx[i];
 *   }
 * });
 * ```
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

  if (queryMeta.added.length > 0 || queryMeta.changed.length > 0) {
    throw new IrisInvalidQuery("queryColumns does not support added() or changed() modifiers");
  }

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
