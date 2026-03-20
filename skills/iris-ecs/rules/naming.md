---
name: naming
description: Entity names -- setName, getName, removeName, lookupByName, uniqueness constraints
metadata:
  tags: name, setName, getName, removeName, lookupByName, entity-name
---

# Entity Names

Optional human-readable names for entities. Names are unique per world and backed by a dual-index registry for O(1) lookups in both directions.

```typescript
import { setName, getName, removeName, lookupByName } from "iris-ecs";
```

## Setting a Name

```typescript
setName(world, player, "player-1");
```

Names must be non-empty and unique within the world. `setName` throws `InvalidArgument` on empty strings and `Duplicate` if the name is already taken by another entity.

Calling `setName` on an already-named entity updates the name. The old name is freed immediately:

```typescript
setName(world, entity, "old-name");
setName(world, entity, "new-name");

lookupByName(world, "old-name");  // undefined
lookupByName(world, "new-name");  // entity
```

Setting the same name again is a no-op.

## Getting a Name

```typescript
const name = getName(world, entity);
// string | undefined
```

Returns `undefined` for unnamed entities.

## Removing a Name

```typescript
removeName(world, entity);
```

Idempotent -- removing a name from an unnamed entity is a no-op.

After removal, the name is available for reuse by other entities.

## Looking Up by Name

```typescript
const player = lookupByName(world, "player-1");
// EntityId | undefined
```

Returns `undefined` if no entity has that name.

Pass components to validate their presence on the found entity:

```typescript
const player = lookupByName(world, "player-1", Position, Health);
// EntityWith<typeof Position | typeof Health> | undefined
```

Returns `undefined` if the entity exists but is missing any of the specified components. The return type is narrowed to `EntityWith<...>`, so subsequent `getComponentValue` calls on the result don't need additional `hasComponent` checks.

## Automatic Cleanup

Names are cleaned up when an entity is destroyed. No manual `removeName` call is needed:

```typescript
setName(world, entity, "enemy-1");
destroyEntity(world, entity);

lookupByName(world, "enemy-1"); // undefined -- name is freed
```

Names are also cleaned up if the `Name` component is removed directly via `removeComponent`.

## Anti-Patterns

Don't use `lookupByName` as a per-frame entity lookup. It's a `Map.get` call -- fast in isolation, but the right tool for entity discovery in hot paths is a cached query:

```typescript
// WRONG: name lookup every frame to find entities
const aiSystem = defineSystem("aiSystem", (world) => {
  return () => {
    const player = lookupByName(world, "player-1");
    if (!player) return;
    // ... chase the player
  };
});

// RIGHT: query for the component that identifies the player
const PlayerTag = defineTag("Player");

const aiSystem = defineSystem("aiSystem", (world) => {
  const players = cacheQuery(world, PlayerTag, Position);
  return () => {
    const player = queryFirstEntity(world, players);
    if (!player) return;
    // ... chase the player
  };
});
```

**Why:** Queries cache their archetype matches and iterate dense storage directly. Name lookups are for point access -- save / load, editor integration, debugging, and one-time setup in system init.

## See Also

- [entities.md](./entities.md) -- creating and destroying entities
- [components.md](./components.md) -- attaching typed data to entities
- [tags.md](./tags.md) -- lightweight markers for entity filtering (prefer over name-based lookup in hot paths)
