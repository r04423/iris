---
name: systems
description: Systems -- defineSystem, addSystem, defineSystemSet, addSystemSet, plain function systems, init/tick separation, before/after ordering, system sets, system-private state
metadata:
  tags: system, defineSystem, addSystem, defineSystemSet, addSystemSet, SystemFactory, SystemRunner, SystemOptions, SystemSetLabel, SystemSetOptions, before, after, set, init, tick
---

# Systems

Systems are functions that operate on the world. A system runs every frame during its assigned schedule, reading and writing components via queries.

```typescript
import { defineSystem, addSystem } from "iris-ecs";
```

## `defineSystem` -- Init/Tick Separation

```typescript
const movementSystem = defineSystem("movementSystem", (world) => {
  // Init: runs once at addSystem() time
  const movers = cacheQuery(world, [Position, Velocity]);

  // Tick: runs every frame
  return () => {
    queryEntities(world, movers, (entity) => {
      const x = getComponentValue(world, entity, Position, "x");
      const vx = getComponentValue(world, entity, Velocity, "x");
      setComponentValue(world, entity, Position, "x", x + vx);
    });
  };
});
```

`defineSystem` takes a name and an init function. The init function receives the `world`, does one-time setup, and returns a tick function that runs every frame. The tick function takes no arguments -- `world` is captured in the closure.

Init runs immediately when `addSystem` is called, not at the first frame. Use it to cache queries, action getters, and resource lookups:

```typescript
const combatSystem = defineSystem("combatSystem", (world) => {
  const enemies = cacheQuery(world, [Enemy, Health]);
  const spawn = spawnActions(world);

  return () => {
    queryEntities(world, enemies, (entity) => {
      const hp = getComponentValue(world, entity, Health, "current");
      if (hp <= 0) {
        destroyEntity(world, entity);
        spawn.explosion(
          getComponentValue(world, entity, Position, "x"),
          getComponentValue(world, entity, Position, "y"),
        );
      }
    });
  };
});
```

## Plain Function Systems

Named functions that take `world` work as systems without `defineSystem`:

```typescript
function resetForces(world: World): void {
  queryEntities(world, [Force], (entity) => {
    setComponentValue(world, entity, Force, "x", 0);
    setComponentValue(world, entity, Force, "y", 0);
  });
}

addSystem(world, resetForces);
```

Plain function systems run the entire function every frame -- no init/tick split. Use them for simple operations that don't need cached queries or one-time setup. For startup-only work like resource initialization, register a plain function in the `Startup` schedule:

```typescript
function initPhysics(world: World): void {
  addResource(world, SpatialHash, { map: new SpatialHashMap(50) });
  addResource(world, PhysicsConfig, { damping: 0.95 });
}

addSystem(world, initPhysics, { schedule: Startup });
```

Functions **must be named**. Anonymous functions throw `InvalidArgument` unless you provide a `name` option:

```typescript
addSystem(world, (world) => { /* ... */ }); // throws InvalidArgument

addSystem(world, (world) => { /* ... */ }, { name: "cleanup" }); // works
```

## `addSystem` -- Registration

```typescript
addSystem(world, system);
addSystem(world, system, options);
```

Accepts either a `SystemFactory` (from `defineSystem`) or a plain `SystemRunner` function. Options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | function/factory name | Overrides the system name. Required for anonymous functions. |
| `schedule` | `ScheduleLabel` | `Update` | Which schedule to run in. Cannot be combined with `set`. See [scheduling.md](./scheduling.md). |
| `set` | `SystemSetLabel` | — | System set to join. Inherits the set's schedule. Cannot be combined with `schedule`. |
| `before` | `SystemReference \| SystemReference[]` | — | This system runs before the named systems or sets. |
| `after` | `SystemReference \| SystemReference[]` | — | This system runs after the named systems or sets. |

`SystemReference` accepts a `SystemFactory` (resolved via `.name`), a `SystemSetLabel`, or a plain `string`.

Throws `Duplicate` if a system with the same name is already registered.

A `defineSystem` factory can be registered multiple times under different names:

```typescript
const damageFlash = defineSystem("damageFlash", (world) => {
  const damaged = cacheQuery(world, [Sprite, added(Damaged)]);
  return () => {
    queryEntities(world, damaged, (entity) => {
      setComponentValue(world, entity, Sprite, "tint", 0xff0000);
    });
  };
});

addSystem(world, damageFlash);
addSystem(world, damageFlash, { name: "healFlash", schedule: PostUpdate });
```

## System Sets -- Group-Level Ordering

System sets are named groups for ordering entire groups of systems relative to each other.

```typescript
import { defineSystemSet, addSystemSet } from "iris-ecs";

const PhysicsSystems = defineSystemSet("PhysicsSystems");
const RenderSystems = defineSystemSet("RenderSystems");

addSystemSet(world, RenderSystems);
addSystemSet(world, PhysicsSystems, { before: RenderSystems });

addSystem(world, applyGravity, { set: PhysicsSystems });
addSystem(world, detectCollisions, { set: PhysicsSystems, after: applyGravity });
addSystem(world, drawSprites, { set: RenderSystems });
```

All physics systems run before all render systems. Systems within a set still respect their own `before`/`after` constraints.

`addSystemSet` options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `schedule` | `ScheduleLabel` | `Update` | Schedule for all systems in this set. |
| `before` | `SystemReference \| SystemReference[]` | — | All members run before these systems or sets. |
| `after` | `SystemReference \| SystemReference[]` | — | All members run after these systems or sets. |

Sets must be registered via `addSystemSet` before any `addSystem` call references them via `set`. Sets are a build-time concept -- the executor sees a flat sorted list.

### Standalone system ordering relative to a set

```typescript
// Run after all physics systems, before all render systems
addSystem(world, debugOverlay, { after: PhysicsSystems, before: RenderSystems });
```

## Ordering with `before` / `after`

Within a schedule, systems run in registration order by default. Use `before` and `after` to enforce ordering constraints:

```typescript
addSystem(world, applyInput);
addSystem(world, applyDamage);
addSystem(world, resolveCollisions, { after: "applyInput", before: "applyDamage" });
```

Both accept a single reference or an array. References can be a `SystemFactory`, a `SystemSetLabel`, or a plain `string`:

```typescript
addSystem(world, renderUI, {
  schedule: Last,
  after: ["updateCamera", "updateParticles"],
});

// Factory reference (resolved via .name)
addSystem(world, collision, { after: gravity });

// Set reference (orders relative to entire group)
addSystem(world, debugOverlay, { after: PhysicsSystems });
```

Constraints are resolved via topological sort within each schedule. Circular dependencies throw `InvalidState` at build time. Referencing a system or set that doesn't exist in the same schedule throws `NotFound`.

## System-Private State

Variables declared in the init closure persist across frames. Use this for system-internal bookkeeping -- frame counters, cooldown timers, scratch buffers:

```typescript
const waveSpawner = defineSystem("waveSpawner", (world) => {
  const spawn = enemyActions(world);
  let elapsed = 0;
  let waveNumber = 0;

  return () => {
    const delta = getResourceValue(world, Time, "delta") ?? 0;
    elapsed += delta;

    if (elapsed >= 3.0) {
      waveNumber++;
      for (let i = 0; i < waveNumber * 2; i++) {
        spawn.enemy(Math.random() * 800, 0);
      }
      elapsed = 0;
    }
  };
});
```

Use init-closure state for data only this system needs. If other systems need to read the data, use a resource ([resources.md](./resources.md)). If it's per-entity data, use a component ([components.md](./components.md)).

## Anti-Patterns

```typescript
// WRONG: caching queries in tick (hash lookup every frame)
const movementSystem = defineSystem("movementSystem", (world) => {
  return () => {
    const movers = cacheQuery(world, [Position, Velocity]);
    queryEntities(world, movers, (entity) => { /* ... */ });
  };
});

// RIGHT: cache in init, reference in tick
const movementSystem = defineSystem("movementSystem", (world) => {
  const movers = cacheQuery(world, [Position, Velocity]);
  return () => {
    queryEntities(world, movers, (entity) => { /* ... */ });
  };
});
```

**Why:** `cacheQuery` deduplicates internally, so calling it in tick isn't catastrophic -- but it's wasted work. Init runs once; tick runs thousands of times. Put allocation and lookup in init, iteration in tick.

---

```typescript
// WRONG: using a plain function when you need cached state
function spawnSystem(world: World): void {
  const spawn = spawnActions(world); // Map lookup every frame
  spawn.enemy(Math.random() * 800, 0);
}

// RIGHT: defineSystem so the getter is cached once
const spawnSystem = defineSystem("spawnSystem", (world) => {
  const spawn = spawnActions(world);
  return () => {
    spawn.enemy(Math.random() * 800, 0);
  };
});
```

**Why:** Plain function systems re-execute the entire body every frame. Any setup work (action getters, query caching, resource lookups) runs repeatedly. Switch to `defineSystem` when the system needs any per-frame state or cached references.

## See Also

- [scheduling.md](./scheduling.md) -- schedule labels, pipeline order, `run`/`runOnce`/`stop`, custom schedules
- [queries.md](./queries.md) -- `cacheQuery`, `queryEntities`, and other query functions cached in init
- [actions.md](./actions.md) -- cached closures for reusable operations, also cached in init
- [change-detection.md](./change-detection.md) -- `added()`, `changed()`, `removed()` require system execution context
- [resources.md](./resources.md) -- world-level state accessed from systems
- [events.md](./events.md) -- inter-system communication via double-buffered event queues
