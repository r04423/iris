---
name: entities
description: Entity lifecycle -- createEntity, destroyEntity, isEntityAlive, addComponents, ID recycling, generation tracking
metadata:
  tags: entity, createEntity, destroyEntity, isEntityAlive, addComponents, lifecycle, ID
---

# Entities

An entity is a 32-bit identifier. It holds no data -- it's just an ID you attach components and tags to.

```typescript
import { createEntity, destroyEntity, isEntityAlive } from "iris-ecs";
```

## Creating Entities

```typescript
const entity = createEntity(world);
```

Returns a branded `Entity` type. You cannot use raw numbers where an `Entity` is expected -- the type system enforces this.

### Creating Entities with Initial Components

`createEntity` accepts an optional entries array to add components in one call:

```typescript
const player = createEntity(world, [
  [Position, { x: 0, y: 0 }],
  [Health, { current: 100, max: 100 }],
  Player,
]);
```

Each entry is either a standalone ID (tag, entity, schema-less pair) or a `[component, data]` tuple for data components and data-carrying pairs. TypeScript validates every entry at compile time -- wrong field names, data on tags, or missing data on data components are type errors.

This is equivalent to calling `createEntity` followed by `addComponents`. See [components.md](./components.md) for details on batch operations.

Entity limit is 1,048,575. Throws `LimitExceeded` if exceeded.

## Destroying Entities

```typescript
destroyEntity(world, entity);
```

Destruction is idempotent -- destroying an already-dead entity is a no-op. Safe to call multiple times.

Destruction removes all components and tags from the entity. If other entities hold pairs targeting this entity, those pairs are cleaned up -- and if the relation has `onDeleteTarget: "delete"`, the subjects are destroyed too (see [relations.md](./relations.md)).

The ID is recycled. Stale references to the old entity will fail `isEntityAlive`.

Fires the `entityDestroyed` observer event.

## Checking Liveness

```typescript
if (isEntityAlive(world, entity)) {
  // safe to use
}
```

Always check before using a stored entity reference. Entity IDs are recycled -- a destroyed entity's raw ID will eventually be reused for a new entity. A stale reference to the old entity will return `false` from `isEntityAlive`.

## ID Recycling

Destroyed entity IDs are recycled. When `createEntity` is called, it may reuse a previously destroyed ID. The old and new entities have different encoded values, so stale references are detectable:

```typescript
const a = createEntity(world);
destroyEntity(world, a);

const b = createEntity(world);
// b may reuse a's underlying ID, but a !== b

isEntityAlive(world, a); // false
isEntityAlive(world, b); // true
```

## The `EntityId` Type

Most iris-ecs functions accept `EntityId`, which is a union of all ID types:

```typescript
type EntityId = Entity | Tag | Component | Relation | Pair;
```

Components, tags, and relations are themselves encoded as entity IDs. You don't need to think about this when writing application code. Just know that `destroyEntity` only recycles regular entity IDs -- component, tag, and relation definitions are permanent.

## Anti-Patterns

`removed()` fires both when a component is explicitly removed and when the entity is destroyed. The entity reference in the event may already be dead:

```typescript
// WRONG: assuming the entity is still alive in a removal event
readEvents(world, removed(Health), (event) => {
  // entity may have been destroyed -- this could hit a recycled ID
  addComponent(world, event.entity, RegenerationCooldown);
});

// RIGHT: check liveness first
readEvents(world, removed(Health), (event) => {
  if (isEntityAlive(world, event.entity)) {
    addComponent(world, event.entity, RegenerationCooldown);
  }
});
```

**Why:** When an entity is destroyed, removal events fire for every component it had. By the time your system reads those events, the entity is already gone. Without the liveness check, you'd be operating on a dead or recycled entity.

## See Also

- [world.md](./world.md) -- creating the world that entities live in
- [components.md](./components.md) -- attaching typed data to entities
- [tags.md](./tags.md) -- lightweight markers for entity filtering
- [naming.md](./naming.md) -- human-readable names for entities
- [relations.md](./relations.md) -- directed connections between entities
- [change-detection.md](./change-detection.md) -- `removed()` events fire on entity destruction
