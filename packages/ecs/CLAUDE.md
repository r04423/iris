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
| `revision.ts` | Revision clock windows: consumption protocol shared by change detection and event reads |
| `scheduler.ts` | System registration and schedule execution |
| `conditions.ts` | Condition primitives (defineCondition, ConditionFactory) and built-ins (once, every) |
| `observer.ts` | Lifecycle event callbacks (entityCreated, componentAdded, etc.) |
| `event.ts` | Event queue system for inter-system communication |
| `resource.ts` | Singleton resources (world-scoped data) |
| `name.ts` | Entity naming and lookup by name |
| `removal.ts` | Removal detection for queries |
| `schema.ts` | Type definitions for component data (Type.f32(), Type.i32(), etc.) |
| `actions.ts` | Cached world-bound action getters |
| `world.ts` | World creation and state container (entity registry, archetypes, queries) |
| `error.ts` | Structured error hierarchy: category classes (LimitExceeded, NotFound, Duplicate, InvalidArgument, InvalidState) and specific per-domain subclasses |

## Architecture

**Everything is an entity** -- Components, tags, and relations are themselves entities with encoded IDs. This unifies the type system: any operation that works on entities works on type metadata. It enables meta-operations like attaching data to components or querying relation targets.

**Entities** -- Packed 32-bit IDs: `[0][type(3)][generation(8)][id(20)]`. Generation tracking detects stale references. Destroyed IDs recycle via LIFO free list. Entity/Tag/Component share this layout; Relations use 8-bit IDs (256 max). Pairs encode `[1][target_type(3)][target_id(20)][relation_id(8)]`.

**Archetypes** -- Columnar storage: each component gets its own TypedArray (or plain array for object fields) per archetype. Parallel `Float64Array` revision columns track `added`/`changed` per entity per component. Bidirectional graph edges between archetypes enable O(1) transitions when adding/removing components. Lazy allocation: capacity starts at 0, grows to 16 on first entity, then 4x.

**Relations** -- Directed entity pairs encoded as `pair(relation, target)`. Wildcard queries match across targets or relations. Exclusive relations auto-remove the previous pair when a new target is set. `onDeleteTarget: "delete"` cascades subject destruction when the target is destroyed. Relations can carry typed data like components.

**Queries** -- Exact term sequences resolve through a world-owned trie. Reordered equivalents share semantic metadata and change cursors, while resolved queries retain requested component order for column callbacks. Filters cache matching archetypes and stay current through `archetypeCreated`/`archetypeDestroyed` observers. Change detection and event reads ONLY work inside system execution context.

**Resources** -- World-level singletons using the component-on-self pattern: a component is added to its own entity ID.

**Events** -- Double-buffered queues (`current`/`previous`, swapped on flush). Each system tracks consumption independently via per-system `lastRevision` cursors. Events survive one full frame cycle. Reads return empty outside system context. Tag events (no schema) and data events (typed schema) share the same API.

**Observers** -- Low-level lifecycle callbacks, not for game logic. Fire during operations: `entityCreated`, `entityDestroying`, `entityDestroyed`, `componentAdded`, `componentRemoved`, `componentChanged`, `archetypeCreated`, `archetypeDestroyed`, `worldReset`. Power filter caching and removal detection internally.

**Removal detection** -- Observer-driven: `componentRemoved` and `entityDestroying` observers lazily emit removal events via `removed()`. Entity destruction emits removal for each component without calling `removeComponent` individually.

**Scheduler** -- Systems are branded, named ticks that receive the world directly. Topological sort uses Kahn's algorithm with registration-order tiebreaking for determinism. Frame tick increments once per frame; the revision clock advances only on consuming reads (`revision.ts`). Default pipeline: `[First, PreUpdate, Update, PostUpdate, Last]`.

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

**Structured errors** -- Preconditions use direct `if`-`throw` with a specific error class from `error.ts`, so the happy path allocates nothing. Specific classes bake fixed details (resource, max, message) into their constructor and take only what varies. Unreachable switch-default paths throw a category class directly. NEVER inline `new Error()`:
```typescript
if (newRawId > ID_MASK_20) {
  throw new IrisEntityLimitExceeded(newRawId);
}
```
Every specific class extends a category (`IrisLimitExceeded`, `IrisNotFound`, `IrisDuplicate`, `IrisInvalidArgument`, `IrisInvalidState`), all of which extend `IrisError`, so `instanceof` works at any granularity.

**Section headers** -- Divide source files into logical regions:
```typescript
// ============================================================================
// Section Name
// ============================================================================
```

**`index.ts` is the public API boundary** -- Only export from `index.ts` what users should access. Internal helpers are exported from their module for cross-module use but MUST NOT be re-exported from `index.ts`.
