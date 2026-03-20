---
name: components
description: Components -- defineComponent, addComponent, removeComponent, hasComponent, getComponentValue, setComponentValue, markComponentChanged
metadata:
  tags: component, defineComponent, addComponent, removeComponent, hasComponent, getComponentValue, setComponentValue, markComponentChanged
---

# Components

Components are typed data attached to entities. Each component has a schema that defines its fields, and each field is stored in a columnar TypedArray (or plain Array for non-numeric types).

```typescript
import {
  defineComponent, addComponent, removeComponent, hasComponent,
  getComponentValue, setComponentValue, markComponentChanged, Type,
} from "iris-ecs";
```

## Defining Components

```typescript
const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });
const Health = defineComponent("Health", { current: Type.i32(), max: Type.i32() });
const Sprite = defineComponent("Sprite", { src: Type.string(), layer: Type.u32() });
```

`defineComponent` takes a name and a schema. The name is for debugging only -- it has no runtime behavior. The schema maps field names to `Type.*()` factories (see [schema.md](./schema.md) for the full list and storage rules).

Define components at module scope. The returned `Component<S, N>` is a branded type that carries the schema at the type level -- field names and types are fully inferred.

Component limit is 1,048,575. Throws `LimitExceeded` if exceeded.

## Adding Components

```typescript
const entity = createEntity(world);
addComponent(world, entity, Position, { x: 0, y: 0 });
addComponent(world, entity, Health, { current: 100, max: 100 });
```

The data argument must include all fields defined in the schema. TypeScript enforces this.

`addComponent` is idempotent -- adding a component that's already present is a no-op. Existing data is preserved, the new data argument is ignored:

```typescript
addComponent(world, entity, Health, { current: 100, max: 100 });
addComponent(world, entity, Health, { current: 50, max: 50 }); // no-op, Health stays at 100/100
```

Fires the `componentAdded` observer event.

### Archetype Transitions

Adding a component moves the entity to a new archetype. This involves copying all of the entity's field data to the new archetype's columns. Reading and writing field values is cheap (direct array index). Adding and removing components is not -- design around stable component sets for entities that update every frame.

## Removing Components

```typescript
removeComponent(world, entity, Health);
```

Idempotent -- removing a component that's not present is a no-op.

Fires the `componentRemoved` observer event. Removal events also fire for every component when an entity is destroyed (see [entities.md](./entities.md)).

## Checking Presence

```typescript
if (hasComponent(world, entity, Position)) {
  // entity is narrowed to EntityWith<typeof Position>
  const x = getComponentValue(world, entity, Position, "x"); // number, not number | undefined
}
```

`hasComponent` narrows the entity to `EntityWith<C>`. Inside the true branch, `getComponentValue` returns the field type directly instead of `T | undefined`.

## Reading Field Values

```typescript
const x = getComponentValue(world, entity, Position, "x");
```

On an unnarrowed entity (no prior `hasComponent` check), the return type is `T | undefined`. Returns `undefined` if the entity doesn't have the component.

On a narrowed `EntityWith<typeof Position>`, the return type is `T` directly, no non-null assertion needed:

```typescript
queryEntities(world, movers, (entity) => {
  const x = getComponentValue(world, entity, Position, "x");
  const vx = getComponentValue(world, entity, Velocity, "x");
  setComponentValue(world, entity, Position, "x", x + vx);
});
```

## Writing Field Values

```typescript
setComponentValue(world, entity, Position, "x", 10);
```

Updates a single field. Automatically marks the component as `changed` for change detection and fires the `componentChanged` observer event.

Silent no-op if the entity doesn't have the component.

## Marking External Changes

```typescript
markComponentChanged(world, entity, Position);
```

Marks a component as changed without setting a value through `setComponentValue`. Use this when you mutate component data through external means (e.g., directly writing to a TypedArray view) and need change detection to pick it up.

## When to Use Components vs. Tags

- Need to store even one field -- **Component** (`Health`, `Position`, `Sprite`)
- Need to filter entities, no data needed -- **Tag** (`Dead`, `Player`, `Visible`) (see [tags.md](./tags.md))
- Reaching for a single `Type.bool()` field -- a **Tag** is almost always the right choice

## Schema Design

### Split by Update Frequency

`setComponentValue` marks the entire component as `changed`. If a system only needs to react when health changes, but you've bundled health and mana into one component, every mana update triggers the health-watching system too.

```typescript
// Coupled: mana updates trigger changed() for systems watching health
const Stats = defineComponent("Stats", {
  health: Type.i32(),
  mana: Type.i32(),
});

// Split: each system reacts only to what it cares about
const Health = defineComponent("Health", { current: Type.i32(), max: Type.i32() });
const Mana = defineComponent("Mana", { current: Type.i32(), max: Type.i32() });
```

The tradeoff: more components means more archetype complexity and wider archetype transitions when composing entities. Split components that are written by different systems or watched independently. Keep fields together when they're always read and written as a unit (e.g., `Position.x` and `Position.y`).

### Nested Data as Entities

If a component holds a variable-length collection of structured data, that collection is often better modeled as child entities with a relation:

```typescript
// Object array: opaque to queries, can't filter individual items
const Inventory = defineComponent("Inventory", {
  items: Type.object<Array<{ itemId: number; count: number }>>(),
});

// Entity-per-item: each slot is queryable, filterable, and independently changeable
const ItemSlot = defineComponent("ItemSlot", { itemId: Type.u32(), count: Type.u32() });
const ChildOf = defineRelation("ChildOf", { exclusive: true, onDeleteTarget: "delete" });

const slot = createEntity(world);
addComponent(world, slot, ItemSlot, { itemId: 42, count: 3 });
addComponent(world, slot, pair(ChildOf, player));
```

Use `Type.object<T>()` when the nested data is truly opaque to the ECS -- configuration blobs, serialized state, or data only one system reads wholesale. Use child entities when you need to query, filter, or independently update individual items.

## Anti-Patterns

```typescript
// WRONG: object schema for simple numeric data (loses TypedArray storage)
const Position = defineComponent("Position", {
  coords: Type.object<{ x: number; y: number }>(),
});

// RIGHT: flat numeric fields get columnar TypedArray storage
const Position = defineComponent("Position", {
  x: Type.f32(),
  y: Type.f32(),
});
```

**Why:** Each flat numeric field gets its own TypedArray column. Iteration touches only the fields a system reads, and the data is cache-line friendly. An `object` field stores JS object references in a plain Array -- no TypedArray benefits, and the garbage collector must trace every reference.

---

```typescript
// WRONG: removing and re-adding a component to "reset" its values
removeComponent(world, entity, Health);
addComponent(world, entity, Health, { current: 100, max: 100 });

// RIGHT: set the fields directly
setComponentValue(world, entity, Health, "current", 100);
setComponentValue(world, entity, Health, "max", 100);
```

**Why:** Remove + add causes two archetype transitions (move out, move back in), copying all of the entity's component data twice. Setting field values is a direct array write with no data movement.

## See Also

- [schema.md](./schema.md) -- `Type.*` factories, TypedArray mapping, schema design guidelines
- [tags.md](./tags.md) -- data-less markers for entity filtering
- [resources.md](./resources.md) -- world-level singletons (components stored on their own entity)
- [queries.md](./queries.md) -- querying entities by component
- [change-detection.md](./change-detection.md) -- `added()`, `changed()`, `removed()` for tracking component changes
