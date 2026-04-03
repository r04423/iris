---
name: queries
description: Queries -- queryEntities, queryColumns, collectEntities, queryFirstEntity, cacheQuery, not(), query modifiers, archetype-based filtering
metadata:
  tags: query, queryEntities, queryColumns, collectEntities, queryFirstEntity, cacheQuery, not, filter, archetype
---

# Queries

Queries fetch entities that match a set of component constraints.

```typescript
import {
  queryEntities, queryColumns, collectEntities, queryFirstEntity,
  cacheQuery, not,
} from "iris-ecs";
```

## `queryEntities` -- Callback Iteration

```typescript
queryEntities(world, [Position, Velocity], (entity) => {
  const x = getComponentValue(world, entity, Position, "x");
  const vx = getComponentValue(world, entity, Velocity, "x");
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
  const hp = getComponentValue(world, entity, Health, "current");
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
const player = queryFirstEntity(world, [Player, Health, not(Dead)]);

if (player !== undefined) {
  const hp = getComponentValue(world, player, Health, "current");
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
      const x = getComponentValue(world, entity, Position, "x");
      const vx = getComponentValue(world, entity, Velocity, "x");
      setComponentValue(world, entity, Position, "x", x + vx);

      const y = getComponentValue(world, entity, Position, "y");
      const vy = getComponentValue(world, entity, Velocity, "y");
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

## `queryColumns` -- Direct Column Access

```typescript
queryColumns(world, [Position, Velocity, not(Dead)], (entities, pos, vel) => {
  for (let i = 0; i < entities.length; i++) {
    const offset = i * 2;
    pos.value[offset] += vel.value[offset];
    pos.value[offset + 1] += vel.value[offset + 1];
  }
});
```

Iterates matching archetypes and passes the raw column storage objects directly to the callback. Each callback invocation receives:

1. `entities` -- the archetype's entity ID array
2. One column object per data-bearing term (components and data relations), in query term order

Tags and data-less pairs are skipped -- they produce no column parameter.

Accepts inline terms or a pre-cached `QueryMeta`:

```typescript
const movers = cacheQuery(world, Position, Velocity, not(Frozen));

queryColumns(world, movers, (entities, pos, vel) => {
  // pos.value is the raw Float32Array for Position
  // vel.value is the raw Float32Array for Velocity
  for (let i = 0; i < entities.length; i++) {
    const offset = i * 2;
    pos.value[offset] += vel.value[offset];
    pos.value[offset + 1] += vel.value[offset + 1];
  }
});
```

Return `false` to stop iteration early.

**Restrictions:** `added()` and `changed()` modifiers are not supported -- throws `InvalidArgument`. Use `queryEntities` for change detection.

### When to Use

Use `queryColumns` when:
- Processing large entity counts with tight TypedArray loops
- Vectorizing operations over contiguous column data
- Avoiding per-entity `getComponentValue` / `getComponentVectorView` overhead

Use `queryEntities` when:
- You need per-entity logic (conditionals, branching per entity)
- Change detection (`added()`, `changed()`)
- Working with non-numeric component fields (strings, objects)
- Entity count is small or iteration isn't a bottleneck

## Anti-Patterns

---

```typescript
// WRONG: using queryEntities with per-entity getters in a tight numeric loop
queryEntities(world, movers, (entity) => {
  const pos = getComponentVectorView(world, entity, Position, "value");
  const vel = getComponentVectorView(world, entity, Velocity, "value");
  pos[0] += vel[0];
  pos[1] += vel[1];
});

// RIGHT: use queryColumns for direct column access
queryColumns(world, movers, (entities, pos, vel) => {
  for (let i = 0; i < entities.length; i++) {
    const offset = i * 2;
    pos.value[offset] += vel.value[offset];
    pos.value[offset + 1] += vel.value[offset + 1];
  }
});
```

**Why:** `queryEntities` calls the callback per entity, and each `getComponentVectorView` does a map lookup + subarray allocation. `queryColumns` gives you the raw TypedArray once per archetype -- you loop over it directly with zero per-entity overhead.

---

```typescript
// WRONG: using queryColumns with added() or changed()
queryColumns(world, [added(Position), Velocity], (entities, pos, vel) => {
  // ...
});

// RIGHT: use queryEntities for change detection
queryEntities(world, [added(Position), Velocity], (entity) => {
  // ...
});
```

**Why:** `queryColumns` operates on full archetype columns. Change detection filters individual entities within archetypes, which requires per-entity evaluation -- use `queryEntities` for this.

## See Also

- [change-detection.md](./change-detection.md) -- `added()`, `changed()`, `removed()` for tracking component mutations over time
- [components.md](./components.md) -- the data that queries filter on
- [tags.md](./tags.md) -- data-less markers that participate in queries
- [relations.md](./relations.md) -- pair queries and wildcard matching
- [systems.md](./systems.md) -- init/tick separation for caching queries
