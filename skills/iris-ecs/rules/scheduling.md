---
name: scheduling
description: Schedules and execution -- First, PreUpdate, Update, PostUpdate, Last, Startup, Shutdown, defineSchedule, insertScheduleBefore, insertScheduleAfter, run, runOnce, stop
metadata:
  tags: schedule, pipeline, defineSchedule, insertScheduleBefore, insertScheduleAfter, run, runOnce, stop, First, PreUpdate, Update, PostUpdate, Last, Startup, Shutdown, ScheduleLabel
---

# Schedules & Execution

Schedules are named execution phases. Each frame, the pipeline runs every schedule in order. Systems are assigned to schedules and sorted within them.

```typescript
import {
  defineSchedule, insertScheduleBefore, insertScheduleAfter,
  run, runOnce, stop,
  First, PreUpdate, Update, PostUpdate, Last, Startup, Shutdown,
  addSystem,
} from "iris-ecs";
```

## Default Pipeline

Every frame executes these schedules left to right:

```
First -> PreUpdate -> Update -> PostUpdate -> Last
```

Two additional schedules run outside the pipeline:

| Schedule | Runs | Typical use |
|----------|------|-------------|
| `Startup` | Once, before the first frame | Resource initialization, scene setup, asset loading |
| `Shutdown` | Once, when `stop()` is called | Cleanup, save state, release handles |

`Update` is the default. A system registered without a `schedule` option lands here:

```typescript
addSystem(world, movementSystem);                              // Update
addSystem(world, readInput, { schedule: First });              // First
addSystem(world, renderSprites, { schedule: PostUpdate });     // PostUpdate
addSystem(world, initResources, { schedule: Startup });        // Startup
addSystem(world, saveProgress, { schedule: Shutdown });        // Shutdown
```

### Choosing a Schedule

| Schedule | When to use |
|----------|-------------|
| `First` | Input polling, time resource updates -- anything downstream systems depend on |
| `PreUpdate` | Pre-processing: spatial indexing, AI decisions, pathfinding |
| `Update` | Core simulation: movement, physics, combat, gameplay logic |
| `PostUpdate` | Reactions to simulation: camera follow, particle emission, collision response |
| `Last` | Rendering, UI sync, debug overlays, telemetry flush |
| `Startup` | One-time setup: spawn initial entities, add resources, load config |
| `Shutdown` | One-time teardown: persist state, disconnect, release resources |

This mirrors the Bevy/Flecs convention of separating input capture from simulation from rendering. The goal is predictable data flow: each phase reads data produced by the phase before it.

## `run` -- Start the Loop

```typescript
const world = createWorld();
addSystem(world, timeSystem, { schedule: First });
addSystem(world, movementSystem);
addSystem(world, renderSystem, { schedule: PostUpdate });

run(world);
```

`run` starts a `requestAnimationFrame` loop. Each frame calls `runOnce` internally. Returns immediately -- the loop runs asynchronously.

No-op if the world is already running.

## `runOnce` -- Single Frame

```typescript
await runOnce(world);
```

Executes exactly one frame: rebuilds schedules if dirty, runs Startup (first call only), runs the full pipeline, flushes events. Returns a `Promise` -- always `await` it.

Use `runOnce` for manual stepping, tests, and server-side loops where `requestAnimationFrame` doesn't exist:

```typescript
// Fixed-timestep server loop
const TICK_MS = 16;

setInterval(async () => {
  setResourceValue(world, Time, "delta", TICK_MS / 1000);
  await runOnce(world);
}, TICK_MS);
```

```typescript
// Test: verify a system's behavior after one frame
addSystem(world, damageSystem);
addComponent(world, enemy, Health, { current: 100, max: 100 });
addComponent(world, enemy, Poisoned, { dps: 25 });

await runOnce(world);

expect(getComponentValue(world, enemy, Health, "current")).toBe(75);
```

## `stop` -- End the Loop

```typescript
await stop(world);
```

Stops the RAF loop, then runs the `Shutdown` schedule. Returns a `Promise` -- `await` it to ensure shutdown systems complete.

### Startup / Shutdown Lifecycle

`stop` resets the startup flag. Calling `run` again re-triggers `Startup`:

```typescript
run(world);             // Startup fires on first frame
// ... game runs ...
await stop(world);      // Shutdown fires

run(world);             // Startup fires again
await stop(world);      // Shutdown fires again
```

This enables clean stop/restart cycles -- level transitions, scene reloads, test isolation.

## `defineSchedule` -- Custom Schedules

```typescript
const Physics = defineSchedule("Physics");
```

Creates a branded `ScheduleLabel`. The label doesn't do anything until inserted into the pipeline.

## `insertScheduleBefore` / `insertScheduleAfter`

```typescript
const Physics = defineSchedule("Physics");
insertScheduleAfter(world, Physics, PreUpdate);

// Pipeline is now: First -> PreUpdate -> Physics -> Update -> PostUpdate -> Last
```

```typescript
const Render = defineSchedule("Render");
insertScheduleBefore(world, Render, Last);

// Pipeline is now: First -> PreUpdate -> Update -> PostUpdate -> Render -> Last
```

Throws `NotFound` if the anchor schedule isn't in the pipeline. Throws `Duplicate` if the new schedule is already in the pipeline.

### Full Custom Schedule Example

A physics pipeline phase with explicit system ordering, separate from gameplay logic:

```typescript
const Physics = defineSchedule("Physics");
insertScheduleAfter(world, Physics, PreUpdate);

addSystem(world, broadPhase, { schedule: Physics });
addSystem(world, narrowPhase, { schedule: Physics, after: "broadPhase" });
addSystem(world, resolveContacts, { schedule: Physics, after: "narrowPhase" });

// Update systems can read collision results without worrying about physics ordering
addSystem(world, applyKnockback);
addSystem(world, playSoundEffects, { schedule: PostUpdate });

run(world);
```

## Async Systems

Systems can return a `Promise`. The scheduler awaits each system sequentially -- async systems don't run in parallel:

```typescript
function loadAssets(world: World): Promise<void> {
  return fetch("/assets/manifest.json")
    .then((r) => r.json())
    .then((manifest) => {
      addResource(world, AssetManifest, { data: manifest });
    });
}

addSystem(world, loadAssets, { schedule: Startup });
```

Async is appropriate for `Startup` / `Shutdown` one-shot work. Avoid async in per-frame schedules -- a system that awaits every frame blocks the entire pipeline until it resolves.

## Anti-Patterns

```typescript
// WRONG: running game logic in Startup
addSystem(world, movementSystem, { schedule: Startup });

// RIGHT: Startup is for one-time initialization, Update is for per-frame logic
addSystem(world, initPhysicsResources, { schedule: Startup });
addSystem(world, movementSystem);
```

**Why:** `Startup` runs once. A movement system there would move entities exactly one frame and never again. Reserve `Startup` for resource initialization, scene setup, and other one-shot work.

---

```typescript
// WRONG: awaiting async work in a per-frame system
const mySystem = defineSystem("mySystem", (world) => {
  return async () => {
    const result = await someAsyncWork();
    // ... use result
  };
});

// RIGHT: start the work synchronously, emit an event when it completes
const mySystem = defineSystem("mySystem", (world) => {
  return () => {
    someAsyncWork().then((result) => {
      emitEvent(world, WorkCompleted, { result });
    });
  };
});
```

**Why:** The scheduler awaits each system sequentially. An async tick function blocks the entire frame until it resolves. Start async work synchronously and bridge results back into the ECS via events -- a downstream system picks them up next frame with `readEvents`. Use async freely in `Startup` and `Shutdown` where latency doesn't affect framerate.

---

```typescript
// WRONG: relying on addSystem call order instead of explicit constraints
addSystem(world, applyInput);     // runs first because registered first?
addSystem(world, movementSystem); // runs second?
addSystem(world, renderSystem);   // runs third?

// RIGHT: declare the ordering contract explicitly
addSystem(world, applyInput);
addSystem(world, movementSystem, { after: "applyInput" });
addSystem(world, renderSystem, { schedule: PostUpdate });
```

**Why:** Registration order is the tiebreaker, not the contract. Adding a system between the first two in a future PR silently changes execution order. Explicit `before`/`after` constraints survive refactoring. For cross-phase ordering, use separate schedules -- that's what they're for.

## See Also

- [systems.md](./systems.md) -- `defineSystem`, `addSystem`, init/tick separation, `before`/`after` ordering
- [world.md](./world.md) -- `createWorld`, `resetWorld` (resets schedules dirty flag)
- [events.md](./events.md) -- events flush automatically at end of each frame
- [change-detection.md](./change-detection.md) -- `added()`, `changed()`, `removed()` depend on system execution context
