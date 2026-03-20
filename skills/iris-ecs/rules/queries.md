---
name: queries
description: Queries -- queryEntities, collectEntities, queryFirstEntity, cacheQuery, not(), query modifiers, archetype-based filtering
metadata:
  tags: query, queryEntities, collectEntities, queryFirstEntity, cacheQuery, not, filter, archetype
---

# Queries

Queries fetch entities that match a set of component constraints.

```typescript
import {
  queryEntities, collectEntities, queryFirstEntity,
  cacheQuery, not,
} from "iris-ecs";
```

## `queryEntities` -- Callback Iteration

```typescript
queryEntities(world, [Position, Velocity], (entity) => {
  const x = getComponentValue(world, entity, Position, "x")!;
  const vx = getComponentValue(world, entity, Velocity, "x")!;
  setComponentValue(world, entity, Position, "x", x + vx);
});
```

Iterates every entity that has all listed components. The callback receives each entity with its type narrowed to `EntityWith<...>`, so `getComponentValue` returns `T` instead of `T | undefined` for components in the query.

Accepts either an inline terms array or a pre-cached `QueryMeta` from `cacheQuery`:

```typescript
// Inline terms -- creates/reuses the query cache internally
queryEntities(world, [Position, Velocity], (entity) => { /* ... */ });

// Pre-cached -- avoids hash lookup on every call
const movers = cacheQuery(world, Position, Velocity);
queryEntities(world, movers, (entity) => { /* ... */ });
```

### Early Exit

Return `false` from the callback to stop iteration:

```typescript
queryEntities(world, [Health], (entity) => {
  const hp = getComponentValue(world, entity, Health, "current")!;
  if (hp <= 0) {
    firstCorpse = entity;
    return false; // stop here
  }
});
```

### Safe Deletion During Iteration

Entities are iterated in reverse order (last added first). Destroying an entity inside the callback is safe:

```typescript
queryEntities(world, [Expired], (entity) => {
  destroyEntity(world, entity); // safe
});
```

## `queryFirstEntity` -- Single Match

```typescript
const player = queryFirstEntity(world, [Player, not(Dead)]);

if (player !== undefined) {
  const hp = getComponentValue(world, player, Health, "current")!;
}
```

Returns the first matching entity, or `undefined` if none match. Useful for singletons or "find one" lookups.

## `collectEntities` -- Array of Matches

```typescript
const enemies = collectEntities(world, [Enemy, Position]);
```

Collects all matching entities into an array. Use when you need random access, sorting, or passing results to non-ECS code. Returns an empty array if nothing matches.

## `cacheQuery` -- Pre-Cache for Systems

```typescript
const movers = cacheQuery(world, Position, Velocity);
const alive = cacheQuery(world, Health, not(Dead));
```

Creates or retrieves cached query metadata. Same terms always return the same cached `QueryMeta` -- calling it twice with `Position, Velocity` returns the same object.

Cache queries in system init, then pass them to `queryEntities` in tick:

```typescript
const movementSystem = defineSystem("movementSystem", (world) => {
  const movers = cacheQuery(world, Position, Velocity, not(Frozen));

  return () => {
    queryEntities(world, movers, (entity) => {
      const x = getComponentValue(world, entity, Position, "x")!;
      const vx = getComponentValue(world, entity, Velocity, "x")!;
      setComponentValue(world, entity, Position, "x", x + vx);

      const y = getComponentValue(world, entity, Position, "y")!;
      const vy = getComponentValue(world, entity, Velocity, "y")!;
      setComponentValue(world, entity, Position, "y", y + vy);
    });
  };
});
```

A query must have at least one required (non-excluded) component. `cacheQuery(world, not(Dead))` alone throws `InvalidArgument`.

Note: `cacheQuery` takes variadic args (`cacheQuery(world, A, B)`), while `queryEntities` takes an array (`queryEntities(world, [A, B], cb)`).

## `not()` -- Exclusion Filter

```typescript
// All entities with Position that don't have Dead or Disabled
queryEntities(world, [Position, not(Dead), not(Disabled)], (entity) => {
  // entity has Position, guaranteed to lack Dead and Disabled
});
```

Excludes entities that have the specified component.

## Querying with Tags and Pairs

Tags and pairs work identically to components in queries:

```typescript
// Tags
const alivePlayers = cacheQuery(world, Player, not(Dead));

// Pairs -- specific target
const children = cacheQuery(world, pair(ChildOf, parent));

// Pairs -- wildcard (any target for this relation)
queryEntities(world, [pair(ChildOf, Wildcard)], (entity) => {
  // every entity that is a child of something
});

// Pairs -- reverse wildcard (any relation to this target)
queryEntities(world, [pair(Wildcard, player)], (entity) => {
  // every entity related to `player` by any relation
});
```

## Anti-Patterns

```typescript
// WRONG: allocating an array every tick when you only need iteration
const movementSystem = defineSystem("movementSystem", (world) => {
  const movers = cacheQuery(world, Position, Velocity);

  return () => {
    const entities = collectEntities(world, movers);
    for (const entity of entities) {
      // ...
    }
  };
});

// RIGHT: callback iteration -- no intermediate array, no iterator overhead
const movementSystem = defineSystem("movementSystem", (world) => {
  const movers = cacheQuery(world, Position, Velocity);

  return () => {
    queryEntities(world, movers, (entity) => {
      // ...
    });
  };
});
```

**Why:** `collectEntities` allocates a new array every call and `for...of` creates an iterator. In a system that runs every frame, this generates garbage the engine must collect. `queryEntities` with a callback iterates in-place with zero allocation.

Use `collectEntities` when you genuinely need an array -- sorting results, passing to non-ECS code, or accessing entities by index. For straight iteration, prefer `queryEntities`.

---

```typescript
// WRONG: re-caching a query in tick
const movementSystem = defineSystem("movementSystem", (world) => {
  return () => {
    const movers = cacheQuery(world, Position, Velocity); // hash lookup every frame
    queryEntities(world, movers, (entity) => { /* ... */ });
  };
});

// RIGHT: cache in init, reuse in tick
const movementSystem = defineSystem("movementSystem", (world) => {
  const movers = cacheQuery(world, Position, Velocity);

  return () => {
    queryEntities(world, movers, (entity) => { /* ... */ });
  };
});
```

**Why:** `cacheQuery` returns the same object if the query already exists, so it's not catastrophically expensive -- but it's wasted work when you can hold the reference from init.

## See Also

- [change-detection.md](./change-detection.md) -- `added()`, `changed()`, `removed()` for tracking component mutations over time
- [components.md](./components.md) -- the data that queries filter on
- [tags.md](./tags.md) -- data-less markers that participate in queries
- [relations.md](./relations.md) -- pair queries and wildcard matching
- [systems.md](./systems.md) -- init/tick separation for caching queries
