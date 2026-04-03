---
name: change-detection
description: Change detection -- added(), changed(), removed(), markComponentChanged, system context requirement
metadata:
  tags: change-detection, added, changed, removed, markComponentChanged, tick, query-modifier
---

# Change Detection

Change detection lets a system react only to entities whose components changed since that system last ran. Two mechanisms, different APIs:

- `added()` and `changed()` are **query modifiers** — pass them alongside components in `cacheQuery` / `queryEntities`.
- `removed()` returns an **Event** — read it with `readEvents`, not with queries.

All three require **system execution context**. Outside a system tick, they silently return empty results.

```typescript
import {
  added, changed, removed,
  cacheQuery, queryEntities,
  readEvents, markComponentChanged,
} from "iris-ecs";
```

## `added()` -- Newly Added Components

Matches entities that gained the specified component since this system last ran.

```typescript
const initSystem = defineSystem("initSystem", (world) => {
  const newPositions = cacheQuery(world, [Position, added(Position)]);

  return () => {
    queryEntities(world, newPositions, (entity) => {
      // Runs once per entity, in the frame Position was added
      const x = getComponentValue(world, entity, Position, "x");
      const y = getComponentValue(world, entity, Position, "y");
      initSpatialIndex(entity, x, y);
    });
  };
});
```

`added(Position)` also implies `Position` in the query — the entity must have the component to have gained it. Including both `Position` and `added(Position)` is redundant but harmless.

An entity matches `added()` only in the frame the component was attached via `addComponent`. It does not re-match on subsequent value changes.

## `changed()` -- Modified or Added Components

Matches entities whose component was modified (via `setComponentValue` or `markComponentChanged`) **or** added since this system last ran.

```typescript
const renderSyncSystem = defineSystem("renderSyncSystem", (world) => {
  const moved = cacheQuery(world, [Position, changed(Position)]);

  return () => {
    queryEntities(world, moved, (entity) => {
      // Runs when Position was added OR when any Position field was set
      const x = getComponentValue(world, entity, Position, "x");
      const y = getComponentValue(world, entity, Position, "y");
      updateRenderPosition(entity, x, y);
    });
  };
});
```

`changed()` is a superset of `added()` — every newly added entity also registers as changed (both ticks are set on add). Use `added()` when you only care about the first frame a component appears. Use `changed()` when you care about any mutation.

## `removed()` -- Component Removal Events

`removed()` returns an Event, not a query modifier. Read it with `readEvents`:

```typescript
const cleanupSystem = defineSystem("cleanupSystem", (world) => {
  return () => {
    readEvents(world, removed(Health), ({ entity }) => {
      // entity just lost Health — play death effect, drop loot, etc.
      addComponent(world, entity, Dead);
    });
  };
});
```

Removal events fire for both explicit `removeComponent` calls and entity destruction (`destroyEntity` emits removal for every component the entity had).

`removed()` follows standard event semantics, see [events.md](./events.md) for the full event API.

## Combining Modifiers

Mix `added()`, `changed()`, and `not()` in the same query. Each modifier applies independently:

```typescript
const movers = cacheQuery(world, [Position, changed(Velocity), not(Frozen)]);
// Entities that:
//   - have Position
//   - had Velocity added or modified since last run
//   - do not have Frozen
```

Multiple change modifiers are AND-combined — an entity must satisfy all of them:

```typescript
const synced = cacheQuery(world, [changed(Position), changed(Rotation)]);
// Only entities where BOTH Position AND Rotation changed
```

Change detection is scoped per system — multiple systems watching `changed(Health)` each see the full set of changes independently. However, querying with the same change-detection modifier **twice in the same system tick** returns empty on the second call (the changes are consumed on first read).

## `markComponentChanged`

`setComponentValue` automatically marks the component as changed. If you mutate data through external means (e.g., writing directly to a TypedArray view), call `markComponentChanged` to notify change detection:

```typescript
markComponentChanged(world, entity, Position);
```

This fires change detection and the `componentChanged` observer without going through `setComponentValue`. Does not cause the entity to match `added()` queries.

## Anti-Patterns

```typescript
// WRONG: change detection outside system context (always empty)
const newEntities = collectEntities(world, [added(Position)]);
console.log(newEntities.length); // always 0

// RIGHT: change detection inside a system
const spawnLogger = defineSystem("spawnLogger", (world) => {
  const spawned = cacheQuery(world, [added(Position)]);

  return () => {
    queryEntities(world, spawned, (entity) => {
      console.log("spawned:", entity);
    });
  };
});
```

**Why:** Change detection requires system context to track what's new since the last run. Outside a system tick, queries with `added()` or `changed()` silently return zero results. Same for `readEvents` with `removed()`. This is the most common source of "it returns nothing" bugs.

---

```typescript
// WRONG: removed() used as a query filter
queryEntities(world, [removed(Health)], (entity) => {
  playDeathAnimation(entity);
});

// RIGHT: removed() returns an Event — read it with readEvents
readEvents(world, removed(Health), ({ entity }) => {
  playDeathAnimation(entity);
});
```

**Why:** `removed()` returns an `Event`, not a query modifier. Passing it to `queryEntities` will not produce the expected results. Use `readEvents` for removal detection, `added()` and `changed()` for query-time filtering.

---

```typescript
// WRONG: using changed() when only first-frame setup is needed
const initSystem = defineSystem("initSystem", (world) => {
  const q = cacheQuery(world, [changed(Position)]);

  return () => {
    queryEntities(world, q, (entity) => {
      // Runs every time Position is modified — wasteful for one-time setup
      initSpatialIndex(entity);
    });
  };
});

// RIGHT: use added() for one-time initialization
const initSystem = defineSystem("initSystem", (world) => {
  const q = cacheQuery(world, [added(Position)]);

  return () => {
    queryEntities(world, q, (entity) => {
      // Runs once when Position is first attached
      initSpatialIndex(entity);
    });
  };
});
```

**Why:** `changed()` matches both additions and modifications. If the system only needs to run once per entity (initialization, registration), `added()` prevents it from re-triggering on every `setComponentValue` call.

## When to Use What

| Situation | Mechanism |
|-----------|-----------|
| One-time setup when component first appears | `added()` |
| React to value changes (dirty flag pattern) | `changed()` |
| Component was removed from an entity | `removed()` via `readEvents` |
| Broadcast notification ("damage occurred") | Event ([events.md](./events.md)) |
| Immediate reaction during the operation itself | Observer ([observers.md](./observers.md)) |
| Poll every entity regardless of changes | Plain query ([queries.md](./queries.md)) |

## See Also

- [queries.md](./queries.md) -- base query API (`queryEntities`, `cacheQuery`, `not()`)
- [events.md](./events.md) -- event system (`readEvents`, `emitEvent`, double buffering)
- [systems.md](./systems.md) -- system context, init/tick separation
- [components.md](./components.md) -- `setComponentValue`, `markComponentChanged`
- [observers.md](./observers.md) -- immediate lifecycle callbacks
