---
name: tags
description: Tags -- defineTag, tag patterns, when to use tags vs. components, archetype implications
metadata:
  tags: tag, defineTag, marker, boolean-state, filtering
---

# Tags

Tags are components with no data. They mark entities for filtering without storing any fields.

```typescript
import { defineTag, addComponent, removeComponent, hasComponent } from "iris-ecs";
```

## Defining Tags

```typescript
const Player = defineTag("Player");
const Dead = defineTag("Dead");
const Selected = defineTag("Selected");
```

`defineTag` returns a branded `Tag` type. The name is for debugging only -- it has no runtime behavior. Define tags at module scope.

## Adding and Removing Tags

Tags use the same `addComponent` / `removeComponent` API as data components. No data argument:

```typescript
addComponent(world, entity, Dead);
removeComponent(world, entity, Dead);
```

Both are idempotent -- adding a tag that's already present is a no-op, removing one that's absent is a no-op.

## Checking for Tags

```typescript
if (hasComponent(world, entity, Player)) {
  // entity is narrowed to EntityWith<typeof Player>
}
```

`hasComponent` narrows the entity type, just like it does for data components.

## Querying with Tags

```typescript
import { cacheQuery, queryEntities, not } from "iris-ecs";

// All alive players
const alivePlayers = cacheQuery(world, [Player, not(Dead)]);

queryEntities(world, alivePlayers, (entity) => {
  // entity has Player, does not have Dead
});
```

## Tags Affect Archetypes

Adding or removing a tag moves the entity to a different archetype, just like a data component. This is the same archetype transition cost.

Design around stable tag sets for entities that update every frame. Frequent tag toggling (adding and removing `Selected` every tick) causes repeated archetype moves.

## When to Use Tags vs. Components

- Need to filter entities, no data needed -- **Tag** (`Dead`, `Player`, `Visible`, `Grounded`)
- Need to store even one field -- **Component** (`Health`, `Position`, `Sprite`)
- Considering a component with a single `Type.bool()` field -- a **Tag** is almost always the right choice

## Anti-Patterns

```typescript
// WRONG: boolean component where a tag suffices
const IsAlive = defineComponent("IsAlive", { value: Type.bool() });
addComponent(world, entity, IsAlive, { value: true });

// RIGHT: tag for boolean state
const Alive = defineTag("Alive");
addComponent(world, entity, Alive);
```

**Why:** A `Type.bool()` component allocates a storage column per archetype, and every query must read a value to check the flag. A tag encodes the state in archetype membership itself -- the query match is the check. No storage, no read.

## See Also

- [components.md](./components.md) -- data components with typed schemas
- [queries.md](./queries.md) -- querying entities by tags and components
