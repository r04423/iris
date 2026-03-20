---
name: world
description: World lifecycle -- createWorld, resetWorld, World type
metadata:
  tags: world, createWorld, resetWorld, lifecycle, setup
---

# World

The World is the container for all ECS state. Every iris-ecs operation takes `world` as its first argument. There are no globals or singletons.

## Creating a World

```typescript
import { createWorld } from "iris-ecs";

const world = createWorld();
```

`createWorld()` returns a fully initialized World -- entity registry, archetype index, default schedule pipeline, observer system, and all internal caches. Call it once at application startup.

Multiple worlds are independent. Nothing is shared between them.

```typescript
const gameWorld = createWorld();
const editorWorld = createWorld();
// These worlds have completely separate entities, components, and systems.
```

## The World Object

World is a plain object, all state is inspectable.

The `world` argument is required for every operation:

```typescript
import { createWorld, createEntity, addComponent, defineComponent, Type } from "iris-ecs";

const world = createWorld();
const entity = createEntity(world);

const Health = defineComponent("Health", { value: Type.f32() });
addComponent(world, entity, Health, { value: 100 });
```

## Resetting a World

```typescript
import { resetWorld } from "iris-ecs";

resetWorld(world);
```

`resetWorld` clears all entities, queries, filters, archetypes, events, actions, and execution state. It preserves:
- Component, tag, and relation **definitions** (these are global, not per-world)
- Schedule **pipeline configuration** (the `First > PreUpdate > Update > PostUpdate > Last` ordering)

After reset, the world is ready for reuse -- same as a fresh `createWorld()` but without reallocating the object.

`resetWorld` does NOT fire per-entity lifecycle events (`entityDestroyed`, `componentRemoved`). If you need cleanup logic before reset, run a shutdown schedule first:

```typescript
import { stop, resetWorld } from "iris-ecs";

// stop() runs the Shutdown schedule, then halts the loop
await stop(world);
resetWorld(world);
// World is now clean -- call run(world) to start again
```

`resetWorld` fires the `worldReset` observer event after reset completes.

## See Also

- [entities.md](./entities.md) -- creating and destroying entities within a world
- [scheduling.md](./scheduling.md) -- `run`, `runOnce`, `stop`, pipeline configuration
- [resources.md](./resources.md) -- world-level shared state (the right way to store globals)
