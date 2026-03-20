---
name: resources
description: Resources -- addResource, removeResource, hasResource, getResourceValue, setResourceValue, world-level singletons
metadata:
  tags: resource, addResource, removeResource, hasResource, getResourceValue, setResourceValue, singleton, global
---

# Resources

Resources are the canonical place for any world state that isn't tied to a specific entity. If data exists once and multiple systems need to read or write it, it's a resource. Frame timing, physics configuration, input state, asset registries, render graphs, audio settings, score counters -- all resources.

```typescript
import {
  defineComponent, addResource, removeResource, hasResource,
  getResourceValue, setResourceValue, Type,
} from "iris-ecs";
```

## Defining and Adding Resources

Resources are regular components stored with `addResource` instead of `addComponent`:

```typescript
const Time = defineComponent("Time", { delta: Type.f64(), elapsed: Type.f64() });
const Physics = defineComponent("Physics", { gravity: Type.f32(), iterations: Type.u32() });

addResource(world, Time, { delta: 0.016, elapsed: 0 });
addResource(world, Physics, { gravity: 9.81, iterations: 4 });
```

Idempotent -- adding a resource that already exists is a no-op. Existing data is preserved.

Internally, `addResource` stores the component on its own entity ID (the component-on-self pattern). There is exactly one storage slot per resource, enforced by the ID system.

## Reading Values

```typescript
const dt = getResourceValue(world, Time, "delta");       // number | undefined
const g = getResourceValue(world, Physics, "gravity");    // number | undefined
```

Returns `undefined` if the resource hasn't been added.

### Type Narrowing with `hasResource`

```typescript
if (hasResource(world, Time)) {
  const dt = getResourceValue(world, Time, "delta");     // number (non-null)
  const el = getResourceValue(world, Time, "elapsed");   // number (non-null)
}
```

`hasResource` narrows the component type so that subsequent `getResourceValue` calls return `T` directly, not `T | undefined`.

## Writing Values

```typescript
setResourceValue(world, Time, "delta", 0.033);
setResourceValue(world, Time, "elapsed", elapsed + dt);
```

Updates a single field. Marks the resource as `changed` for change detection and fires the `componentChanged` observer event.

## Removing Resources

```typescript
removeResource(world, Time);
```

Idempotent -- removing a resource that doesn't exist is a no-op.

## Resources in Queries

Resources appear in standard queries because they're stored as components on an entity:

```typescript
const timeQuery = cacheQuery(world, Time);

queryEntities(world, timeQuery, (entity) => {
  // entity === Time (the component ID itself)
  const dt = getComponentValue(world, entity, Time, "delta")!;
});
```

This is a consequence of the component-on-self pattern, not its intended use. Prefer `getResourceValue` for direct access -- it's clearer and avoids the query overhead.

## Resources in Systems

A typical pattern: read a resource in the tick function.

```typescript
const physicsSystem = defineSystem("physicsSystem", (world) => {
  const movers = cacheQuery(world, Position, Velocity);
  return () => {
    if (!hasResource(world, Time)) return;
    const dt = getResourceValue(world, Time, "delta");
    queryEntities(world, movers, (entity) => {
      const vy = getComponentValue(world, entity, Velocity, "y");
      setComponentValue(world, entity, Velocity, "y", vy + 9.81 * dt);
    });
  };
});
```

## Anti-Patterns

```typescript
// WRONG: module-level state outside the world
let gameScore = 0;
let isPaused = false;

const scoreSystem = defineSystem("scoreSystem", (world) => {
  return () => {
    gameScore += 10; // invisible to other systems, not reset by resetWorld
  };
});

// RIGHT: store it as a resource -- all world state lives in the world
const GameState = defineComponent("GameState", { score: Type.i32(), paused: Type.bool() });
addResource(world, GameState, { score: 0, paused: false });
```

**Why:** Module-level variables live outside the world. They survive `resetWorld`, can't be inspected by devtools, don't participate in change detection, and create implicit coupling between systems. A resource keeps all state in the world where it can be queried, serialized, and reset uniformly.

---

```typescript
// WRONG: caching state in system closures
const movementSystem = defineSystem("movementSystem", (world) => {
  let frameCount = 0;
  return () => {
    frameCount++;
  };
});

// RIGHT: use a resource
const FrameCount = defineComponent("FrameCount", { value: Type.u32() });
addResource(world, FrameCount, { value: 0 });
```

**Why:** Closure state is private to one system. If another system needs the frame count, you have to restructure. Resource state is accessible to any system through `getResourceValue`.

---

```typescript
// WRONG: storing global state in a component on a manually created entity
const configEntity = createEntity(world);
addComponent(world, configEntity, Physics, { gravity: 9.81, iterations: 4 });

// RIGHT: use the resource API
addResource(world, Physics, { gravity: 9.81, iterations: 4 });
```

**Why:** A manually created entity is just another entity -- you need to track its ID, pass it around, and guard against accidental destruction. `addResource` gives you a stable handle (the component itself) and a dedicated API for access.

## See Also

- [components.md](./components.md) -- data components with typed schemas
- [schema.md](./schema.md) -- `Type.*` factories and storage rules
- [queries.md](./queries.md) -- querying entities by component
