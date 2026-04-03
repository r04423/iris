---
name: relations
description: Relations -- defineRelation, pair, getPairRelation, getPairTarget, getRelationTargets, Wildcard, exclusive relations, cascade deletion, data relations
metadata:
  tags: relation, defineRelation, pair, Wildcard, exclusive, cascade, onDeleteTarget, data-relation, getRelationTargets
---

# Relations

Relations model connections between entities -- parent-child hierarchies, targeting, ownership, group membership, inventory slots. Without relations, these connections live in component fields as raw entity IDs: opaque to the query engine, invisible to cleanup logic, and requiring manual bookkeeping to keep consistent. Relations make the connection itself a first-class part of the ECS: queryable, automatically cleaned up on entity destruction, and composable with the rest of the API.

A relation encodes "entity A has relation R to entity B" as a `Pair` that behaves like a component -- added, removed, queried, and stored using the same API.

```typescript
import {
  defineRelation, pair, getPairRelation, getPairTarget, getRelationTargets,
  Wildcard, addComponent, removeComponent, hasComponent,
  getComponentValue, setComponentValue, Type,
} from "iris-ecs";
```

## Defining Relations

```typescript
const ChildOf = defineRelation("ChildOf");
const Likes = defineRelation("Likes");
```

Define relations at module scope. Hard limit of 256 unique relations (8-bit ID space) -- throws `LimitExceeded` if exceeded.

### Options

```typescript
const ChildOf = defineRelation("ChildOf", {
  exclusive: true,            // entity can have at most one target for this relation
  onDeleteTarget: "delete",   // cascade-delete subjects when the target is destroyed
});
```

- `exclusive` -- adding a new target auto-removes the previous one. Default: `false`.
- `onDeleteTarget` -- `"remove"` (default) strips the pair from subjects when the target is destroyed. `"delete"` destroys the subjects too.

## Creating and Using Pairs

`pair(relation, target)` creates a `Pair` that acts like a component:

```typescript
const parent = createEntity(world);
const child = createEntity(world);

addComponent(world, child, pair(ChildOf, parent));

if (hasComponent(world, child, pair(ChildOf, parent))) {
  removeComponent(world, child, pair(ChildOf, parent));
}
```

Pairs follow the same rules as regular components -- `addComponent` is idempotent, `removeComponent` is idempotent, `hasComponent` narrows the entity type.

## Extracting Relation and Target

```typescript
const p = pair(ChildOf, parent);
const relation = getPairRelation(p);  // ChildOf
const target = getPairTarget(world, p); // parent
```

## Getting All Targets

```typescript
const friends = getRelationTargets(world, player, Likes);
// [npc1, npc2, npc3] -- all entities that player Likes
```

Returns an empty array if the entity has no pairs with that relation.

## Querying with Pairs

Pairs participate in queries like any component:

```typescript
const children = cacheQuery(world, [pair(ChildOf, parent)]);

queryEntities(world, children, (entity) => {
  // every entity that is a child of `parent`
});
```

## Wildcard Queries

Wildcard pairs match across relations or targets. They're managed automatically -- `addComponent` injects the wildcard pairs, `removeComponent` cleans them up.

**Any relation to a specific target:**

```typescript
// Find all entities that have any relation to `player`
queryEntities(world, [pair(Wildcard, player)], (entity) => {
  // matches pair(ChildOf, player), pair(Likes, player), pair(Targets, player), etc.
});
```

**Any target for a specific relation:**

```typescript
// Find all entities that are a child of something
queryEntities(world, [pair(ChildOf, Wildcard)], (entity) => {
  // matches pair(ChildOf, parent1), pair(ChildOf, parent2), etc.
});
```

## Exclusive Relations

When `exclusive: true`, an entity can hold at most one target for that relation. Adding a new target removes the old one automatically:

```typescript
const ChildOf = defineRelation("ChildOf", { exclusive: true });

addComponent(world, child, pair(ChildOf, parent1));
addComponent(world, child, pair(ChildOf, parent2)); // pair(ChildOf, parent1) auto-removed

const targets = getRelationTargets(world, child, ChildOf);
// [parent2] -- always 0 or 1 targets
```

Non-exclusive relations (the default) allow multiple targets:

```typescript
const Likes = defineRelation("Likes");

addComponent(world, player, pair(Likes, npc1));
addComponent(world, player, pair(Likes, npc2));
addComponent(world, player, pair(Likes, npc3));

const friends = getRelationTargets(world, player, Likes);
// [npc1, npc2, npc3]
```

## Cascade Deletion

`onDeleteTarget: "delete"` destroys subjects when the target entity is destroyed:

```typescript
const ChildOf = defineRelation("ChildOf", {
  exclusive: true,
  onDeleteTarget: "delete",
});

const parent = createEntity(world);
const child = createEntity(world);
addComponent(world, child, pair(ChildOf, parent));

destroyEntity(world, parent);
isEntityAlive(world, child); // false -- cascade-deleted
```

With `onDeleteTarget: "remove"` (default), destroying the target just strips the pair. The subject survives:

```typescript
const Likes = defineRelation("Likes");

addComponent(world, player, pair(Likes, npc));
destroyEntity(world, npc);
isEntityAlive(world, player); // true -- still alive, pair removed
```

## Data Relations

Relations can carry typed data by defining a schema. The pair then supports `getComponentValue` and `setComponentValue`:

```typescript
const Targets = defineRelation("Targets", {
  schema: { priority: Type.i8(), range: Type.f32() },
  exclusive: true,
});

const turret = createEntity(world);
const enemy = createEntity(world);

addComponent(world, turret, pair(Targets, enemy), { priority: 10, range: 50.0 });

const priority = getComponentValue(world, turret, pair(Targets, enemy), "priority"); // 10
setComponentValue(world, turret, pair(Targets, enemy), "priority", 20);
```

Schema types follow the same rules as component schemas -- see [schema.md](./schema.md) for `Type.*` factories and storage implications.

## When to Use Relations

- Need to query "all entities connected to X" -- **Relation**. The pair encodes the target in the archetype, so the query engine resolves it without scanning every entity.
- Need automatic cleanup when the target is destroyed -- **Relation** with `onDeleteTarget`. Without this, stale references accumulate silently.
- Entity belongs to exactly one group/parent -- **Relation** with `exclusive: true`. The constraint is enforced by the ECS, not by application code.
- Variable-length collections of structured data on an entity (inventory, ability slots, status effects) -- model each item as its own entity linked back with a relation, instead of a `Type.object<Array<...>>()` field. Each item becomes independently queryable, filterable, and changeable. See [components.md](./components.md) for the full pattern.
- Storing a reference that only one system reads, no querying or cleanup needed -- a **Component** with a `Type.u32()` field is simpler. Use relations when the connection matters to more than one system or when you need the ECS to manage its lifecycle.

## Anti-Patterns

```typescript
// WRONG: storing parent reference as a component field
const ChildInfo = defineComponent("ChildInfo", { parentId: Type.u32() });
addComponent(world, child, ChildInfo, { parentId: extractId(parent) });

// manual query: scan every entity, filter in the loop
queryEntities(world, [ChildInfo], (entity) => {
  if (getComponentValue(world, entity, ChildInfo, "parentId") === extractId(parent)) {
    // ...
  }
});

// RIGHT: relation query resolves at the archetype level
const ChildOf = defineRelation("ChildOf", { exclusive: true, onDeleteTarget: "delete" });
addComponent(world, child, pair(ChildOf, parent));

queryEntities(world, [pair(ChildOf, parent)], (entity) => {
  // only iterates actual children of `parent`
});
```

**Why:** The component-field approach forces a linear scan with a per-entity conditional. The relation encodes the connection in archetype membership -- the query engine skips non-matching archetypes entirely. The component-field approach also gives you no cleanup on target destruction: if `parent` is destroyed, every entity with `parentId` pointing to it becomes a dangling reference. Relations handle both problems.

## See Also

- [schema.md](./schema.md) -- `Type.*` factories for data relation schemas
- [components.md](./components.md) -- `addComponent`, `removeComponent`, `hasComponent`, `getComponentValue`, `setComponentValue` (all work with pairs)
- [entities.md](./entities.md) -- `createEntity`, `destroyEntity`, `isEntityAlive`
- [queries.md](./queries.md) -- querying entities by components and pairs
