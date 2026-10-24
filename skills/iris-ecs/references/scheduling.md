# Scheduling

Scheduling is where an Iris program is composed. Systems stay simple, so the
decisions that shape behavior move here: which phase each system runs in, what
must come before what, and when a system sits out. Make those decisions
explicit, and keep them where a reader finds the whole frame (see "Assembling
the frame" in `references/architecture.md`).

## Contents

- The frame
- Choosing a schedule
- Ordering within a schedule
- System sets
- Conditions
- Custom schedules
- Running the world

---

## The frame

Each frame runs the pipeline of schedules in order, then retires old events:

```
First -> PreUpdate -> Update -> PostUpdate -> Last
```

`Startup` runs once, inside the first frame, before the pipeline. `Shutdown`
runs once when the world is stopped. A system registered without a schedule
goes in `Update`.

---

## Choosing a schedule

Coarse order comes from the schedule. Pick it by what the system does:

| Schedule | Holds | Examples |
|---|---|---|
| `Startup` | Adding resources, spawning the initial scene, loading assets | `initTime`, `initCombat`, `spawnPlayer`, `loadAssets` |
| `First` | Bookkeeping every other system relies on | `tickTime` |
| `PreUpdate` | Turning outside input into data | `readInput` |
| `Update` | Gameplay decisions and movement | `applyInput`, `handleFire`, `moveEntities` |
| `PostUpdate` | Consequences and cleanup | `applyHits`, `markDead`, `despawnDead` |
| `Last` | Presenting the result | `render`, `tintShielded`, `flashOnDamage` |
| `Shutdown` | Saving and teardown | `saveHighScore` |

Most ordering questions answer themselves once each system is in the right
phase. Prefer moving a system to another schedule over adding constraints
across domains.

`Startup` systems may be `async`; the frame waits for each one, so the systems
that need loaded assets can rely on them. An async system anywhere else blocks
its frame too, so keep slow work in `Startup`.

---

## Ordering within a schedule

Within a schedule, systems run in registration order. When one system must see
another's output in the same frame, say so with `before` or `after`:

```ts
addSystem(world, applyHits, { schedule: PostUpdate });

addSystem(world, markDead, {
  schedule: PostUpdate,
  after: [applyHits],
});

// Score reads the Dead tag, and must see entities before they are despawned
addSystem(world, awardScore, {
  schedule: PostUpdate,
  after: [markDead],
  before: [despawnDead],
});

addSystem(world, despawnDead, { schedule: PostUpdate });
```

- Add a constraint only for a real data dependency: a writer before its reader,
  an emitter before the consumer that must react this frame.
- Do not rely on registration order between domains. If it matters, state it.
- `before` and `after` accept systems, system sets, or names, and only work
  within one schedule. Naming a system in another schedule throws
  `IrisSystemNotFound`. Constraints are checked on the next frame, not when you
  call `addSystem`.
- A cycle throws `IrisCircularDependency`.
- Registering the same system twice throws `IrisDuplicateSystem` unless the
  second registration passes a distinct `name`.
- Systems added while a frame runs take effect on the next frame.

---

## System sets

A set labels a group of systems so they can be ordered, or switched off,
together:

```ts
import { addSystems, addSystemSet, defineSystemSet, PostUpdate } from "iris-ecs";

export const Simulation = defineSystemSet("Simulation");
export const Cleanup = defineSystemSet("Cleanup");

addSystemSet(world, Simulation, { schedule: PostUpdate });

addSystemSet(world, Cleanup, {
  schedule: PostUpdate,
  after: [Simulation],
});

addSystems(world, [
  applyHits,
  markDead,
], { set: Simulation });

addSystems(world, [
  despawnDead,
  despawnExpired,
], { set: Cleanup });
```

Every system in `Cleanup` runs after every system in `Simulation`, and systems
inside a set still honor their own `before` and `after`. A system takes either
`schedule` or `set`, not both, because the set knows its schedule. Sets are a
good way to order domains against each other without naming their systems.

---

## Conditions

A condition decides whether a system or set runs this frame. Conditions over
resources turn whole features on and off, such as a pause or a feature flag:

```ts
import { defineCondition, every, once } from "iris-ecs";

export const Settings = defineComponent("Settings", {
  schema: {
    paused: Type.bool(),
    // A feature flag, set from the app's own config
    minimap: Type.bool(),
  },
});

export const gameIsRunning = defineCondition("gameIsRunning", (world) => {
  return getResourceValue(world, Settings, "paused") === false;
});

export const minimapEnabled = defineCondition("minimapEnabled", (world) => {
  return getResourceValue(world, Settings, "minimap") === true;
});

addSystemSet(world, Simulation, {
  schedule: PostUpdate,
  condition: gameIsRunning,
});

addSystemSet(world, Minimap, {
  schedule: Last,
  condition: minimapEnabled,
});

// Every tenth check: expensive work that may lag a little
addSystem(world, retarget, { condition: every(10) });

// The first check only
addSystem(world, showIntro, { condition: once() });
```

- A condition definition is checked at most once per schedule per frame, and
  every system using it shares the answer.
- Conditions run outside any system. They can read components and resources,
  but event reads and `added` or `changed` see nothing there.
- Use a condition for a rule shared by many systems, such as pausing or a
  feature flag. Use an early return inside the system for reasons that come
  from its own data.
- Each system and set takes one condition. A system in a set with a condition
  runs only when both pass. For any other combination, write a condition that
  calls the others' `check(world)`.
- Every call to `defineCondition`, `once()`, or `every(n)` makes a new
  condition with its own state. Keep the result in a constant and share it.
- A condition may run a plain query, e.g. `queryFirstEntity(world, [Boss]) !== undefined`
  to run a system only while a boss exists.
- A system skipped by a condition still loses events that expire meanwhile.

---

## Custom schedules

When a domain needs its own phase, define a schedule and insert it next to an
existing one:

```ts
// combat/schedule.ts
export const Combat = defineSchedule("Combat");

// where the frame is assembled
insertScheduleAfter(world, Combat, Update);
addSystem(world, applyHits, { schedule: Combat });
```

The pipeline becomes `First`, `PreUpdate`, `Update`, `Combat`, `PostUpdate`,
`Last`. `insertScheduleBefore` inserts on the other side. Write the full
pipeline in a comment where the frame is assembled, so readers see it without
following every insert.

---

## Running the world

| Call | Effect |
|---|---|
| `run(world)` | Starts the loop on `requestAnimationFrame`. Ignored if already running |
| `run(world, createTimeoutDriver(50))` | Same loop on a timer, e.g. on a server |
| `await runOnce(world)` | Runs one frame. For tests and manual stepping. Throws `IrisSchedulerBusy` while `run` is active |
| `await suspend(world)` | Pauses after the current frame. `Shutdown` does not run, and the next `run` resumes without `Startup` |
| `await stop(world)` | Ends the session. `Shutdown` runs, and the next `run` starts again with `Startup` |
| `resetWorld(world)` | Clears entities, resources, and events, keeps definitions and systems. `Startup` runs again next frame. Stop the world first |

If a system throws, the frame stops and the loop stops. Register a
`frameFailed` observer to log the error; the observer may call `run` again.

A custom `FrameDriver` is an object with `request` and `cancel`, the same shape
as `requestAnimationFrame` and `cancelAnimationFrame`.
