---
name: actions
description: Actions -- defineActions, cached world-bound closures, spawn helpers, system integration
metadata:
  tags: action, defineActions, closure, spawn, helper, cached
---

# Actions

Actions bundle reusable ECS operations into cached, world-bound closures. Define a set of functions that capture `world` once, then call them anywhere without passing `world` again. Useful for spawn helpers, update batches, and any multi-step operation that gets repeated.

```typescript
import { defineActions } from "iris-ecs";
```

## Defining Actions

`defineActions` takes an initializer function that receives a `world` and returns an object of functions:

```typescript
import {
  defineActions, createEntity, addComponent, defineComponent, defineTag, Type,
} from "iris-ecs";

const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });
const Velocity = defineComponent("Velocity", { x: Type.f32(), y: Type.f32() });
const Player = defineTag("Player");
const Enemy = defineTag("Enemy");

const spawnActions = defineActions((world) => ({
  player(x: number, y: number) {
    const entity = createEntity(world);
    addComponent(world, entity, Position, { x, y });
    addComponent(world, entity, Velocity, { x: 0, y: 0 });
    addComponent(world, entity, Player);
    return entity;
  },
  enemy(x: number, y: number) {
    const entity = createEntity(world);
    addComponent(world, entity, Position, { x, y });
    addComponent(world, entity, Enemy);
    return entity;
  },
}));
```

Define actions at module scope. The initializer runs lazily on first access per world, not at definition time.

## Using Actions

Call the getter with a `world` to get the cached actions object:

```typescript
const spawn = spawnActions(world);
spawn.player(0, 0);
spawn.enemy(100, 50);
```

The getter returns the same object on every call for a given world. The initializer runs once -- subsequent calls are a Map lookup.

## Actions in Systems

Cache the getter result in init, use it in tick:

```typescript
const waveSystem = defineSystem("waveSystem", (world) => {
  const spawn = spawnActions(world);

  return () => {
    spawn.enemy(Math.random() * 800, 0);
  };
});
```

## Closure State

The initializer can hold private state in its closure. This state is per-world and persists across calls:

```typescript
const poolActions = defineActions((world) => {
  const pool: Entity[] = [];

  return {
    acquire() {
      return pool.length > 0 ? pool.pop()! : createEntity(world);
    },
    release(entity: Entity) {
      pool.push(entity);
    },
  };
});
```

Two worlds calling `poolActions(worldA)` and `poolActions(worldB)` get independent pools. All systems using `poolActions(worldA)` share the same pool instance.

## Lifecycle

Actions are cleared on `resetWorld`. After a reset, the next getter call re-runs the initializer and rebuilds any closure state.

## Anti-Patterns

```typescript
// WRONG: calling the getter in tick (Map lookup every frame)
const movementSystem = defineSystem("movementSystem", (world) => {
  return () => {
    const spawn = spawnActions(world); // unnecessary repeated lookup
    spawn.enemy(Math.random() * 800, 0);
  };
});

// RIGHT: cache in init
const movementSystem = defineSystem("movementSystem", (world) => {
  const spawn = spawnActions(world);
  return () => {
    spawn.enemy(Math.random() * 800, 0);
  };
});
```

**Why:** The getter is cheap (a single Map lookup), but caching in init removes even that overhead and keeps tick bodies focused on per-frame logic. This matches the same pattern used for `cacheQuery` -- init is for setup, tick is for work.

## See Also

- [systems.md](./systems.md) -- system init/tick separation where actions are cached
- [components.md](./components.md) -- `addComponent` and component operations used inside actions
- [resources.md](./resources.md) -- world-level shared state (use resources for data, actions for operations)
