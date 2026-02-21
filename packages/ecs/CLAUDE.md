# iris-ecs

Core ECS library for Iris.

## Module Overview

| Module | Responsibility |
|--------|----------------|
| `encoding.ts` | Bit-packed ID encoding (Entity, Tag, Component, Relation, Pair types) |
| `entity.ts` | Entity lifecycle (create, destroy, aliveness check, ID recycling) |
| `component.ts` | Component add/remove/get/set operations, archetype transitions |
| `archetype.ts` | Columnar storage, capacity management, graph traversal |
| `registry.ts` | Component/Tag/Relation definitions (defineComponent, defineTag, defineRelation) |
| `relation.ts` | Pair encoding/decoding, relation target queries |
| `query.ts` | Entity queries with filters (added, changed, not), change detection |
| `filters.ts` | Query filter matching against archetypes |
| `scheduler.ts` | System registration and schedule execution |
| `observer.ts` | Lifecycle event callbacks (entityCreated, componentAdded, etc.) |
| `event.ts` | Event queue system for inter-system communication |
| `resource.ts` | Singleton resources (world-scoped data) |
| `name.ts` | Entity naming and lookup by name |
| `removal.ts` | Removal detection for queries |
| `schema.ts` | Type definitions for component data (Type.f32(), Type.i32(), etc.) |
| `actions.ts` | Cached world-bound action getters |
| `world.ts` | World creation and state container (entity registry, archetypes, queries) |
| `error.ts` | Structured error classes (LimitExceeded, NotFound, Duplicate, InvalidArgument, InvalidState) and assert() |

## Architecture

**Everything is an entity** -- Components, tags, and relations are themselves entities with encoded IDs. This unifies the type system: any operation that works on entities works on type metadata. It enables meta-operations like attaching data to components or querying relation targets.

**Entities** -- Packed 32-bit IDs: `[0][type(3)][generation(8)][id(20)]`. Generation tracking detects stale references. Destroyed IDs recycle via LIFO free list. Entity/Tag/Component share this layout; Relations use 8-bit IDs (256 max). Pairs encode `[1][target_type(3)][target_id(20)][relation_id(8)]`.

**Archetypes** -- Columnar storage: each component gets its own TypedArray (or plain array for object fields) per archetype. Parallel `Uint32Array` tick columns track `added`/`changed` per entity per component. Bidirectional graph edges between archetypes enable O(1) transitions when adding/removing components. Lazy allocation: capacity starts at 0, grows to 16 on first entity, then 4x.

**Relations** -- Directed entity pairs encoded as `pair(relation, target)`. Wildcard queries match across targets or relations. Exclusive relations auto-remove the previous pair when a new target is set. `onDeleteTarget: "delete"` cascades subject destruction when the target is destroyed. Relations can carry typed data like components.

**Queries** -- Built on filters that cache matching archetypes. Observer callbacks (`archetypeCreated`/`archetypeDestroyed`) keep filter caches current without polling. Per-system `lastTick` tracking powers change detection (`added()`, `changed()` modifiers). Change detection and event reads ONLY work inside system execution context.

**Resources** -- World-level singletons using the component-on-self pattern: a component is added to its own entity ID.

**Events** -- Double-buffered queues (`current`/`previous`, swapped on flush). Each system tracks consumption independently via per-system `lastTick`. Events survive one full frame cycle. Reads return empty outside system context. Tag events (no schema) and data events (typed schema) share the same API.

**Observers** -- Low-level lifecycle callbacks, not for game logic. Fire during operations: `entityCreated`, `entityDestroyed`, `componentAdded`, `componentRemoved`, `componentChanged`, `archetypeCreated`, `archetypeDestroyed`, `worldReset`. Power filter caching and removal detection internally.

**Removal detection** -- Observer-driven: `componentRemoved` and `entityDestroyed` observers lazily emit removal events via `removed()`. Entity destruction emits removal for each component without calling `removeComponent` individually.

**Scheduler** -- Topological sort via Kahn's algorithm with registration-order tiebreaker for determinism. Tick increments before each system execution + post-bump in `finally` block. Default pipeline: `[First, PreUpdate, Update, PostUpdate, Last]`.

## Code Patterns

**Branded types** -- Never use raw numbers for Entity, Tag, Component, or Relation IDs:
```typescript
type Entity = number & { [ENTITY_BRAND]: true };
```

**Index-based for loops** -- MUST use index-based `for` loops in hot paths. `for...of` creates iterator overhead:
```typescript
for (let i = 0; i < entities.length; i++) {
  const entity = entities[i]!;
}
```

**Non-null assertions** (`!`) -- Allowed and expected in performance-critical paths where bounds are guaranteed by surrounding logic.

**Swap-and-pop deletion** -- O(1) removal from dense arrays. Move last element into vacated slot, pop the end. Caller MUST update the swapped entity's row metadata.

**Backward iteration for safe deletion** -- When removing items from arrays during iteration, MUST iterate backward to prevent index-shifting bugs. Also applies to observer dispatch (callbacks can safely unregister themselves).

**Structured errors with `assert()`** -- Preconditions use `assert()` for lazy construction and type narrowing. Switch-default/unreachable paths use direct `throw`. NEVER inline `new Error()`:
```typescript
assert(rawId <= ID_MASK_20, LimitExceeded, { resource: "Entity", max: ID_MASK_20, id: rawId });
```
Error classes: `LimitExceeded`, `NotFound`, `Duplicate`, `InvalidArgument`, `InvalidState` (all extend `IrisError`).

**Section headers** -- Divide source files into logical regions:
```typescript
// ============================================================================
// Section Name
// ============================================================================
```

**`index.ts` is the public API boundary** -- Only export from `index.ts` what users should access. Internal helpers are exported from their module for cross-module use but MUST NOT be re-exported from `index.ts`.
