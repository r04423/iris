---
name: iris-ecs
description: >-
  Designs, writes, debugs, and tests applications built on iris-ecs, the Entity
  Component System for TypeScript. Use when code imports iris-ecs, or when the
  user plans or changes an Iris ECS feature: choosing its domain, modeling data
  with defineComponent and Type schemas, tags, resources, defineRelation and
  pair, writing systems with collectEntities, added/changed change detection,
  defineEvent and readEvents, defineActions, ordering the frame with schedules,
  system sets, and conditions, or testing with runOnce. Do not use for other ECS
  libraries (bitECS, Koota, miniplex, Bevy, flecs, Unity DOTS) unless the task
  is porting their code to Iris.
---

# Iris ECS

Iris is an Entity Component System for TypeScript, published as `iris-ecs`. An
entity is a number, a component is typed data stored in columns, and a system is
a named function that runs every frame. The API is plain functions that take the
`world` first. There are no classes and no methods on entities.

Iris borrows ideas from flecs (IDs, pairs, names) and Bevy (schedules, change
detection, events), but its API and rules are its own. Do not carry over code or
habits from those libraries or from bitECS, Koota, miniplex, or others. Where
this skill and your memory of another ECS disagree, this skill is right.

This skill is written for iris-ecs `0.0.15`. Check the installed version in
`node_modules/iris-ecs/package.json`. The installed types in
`node_modules/iris-ecs/dist/index.d.ts` are the ground truth: every export has
JSDoc with an example. Read the signature there before using an API you have
not used yet in this session, and fix a type error from the signature, not with
a cast or `!`.

When the project already has its own architecture and conventions, follow them
over the defaults here.

---

## How to build a feature

Good ECS code comes from design, not from clever systems. Each system stays
small, and the complexity lives in how data, systems, and schedules compose.
Work through these steps in order, and **read the reference for a step before
writing code for it**. Most bugs in ECS code are design mistakes from an
earlier step.

1. **Find the domain.** Decide which domain (input, physics, combat, render...)
   owns the feature, and where its files go. Read `references/architecture.md`.
2. **Model the data.** Decide the components, tags, resources, relations, and
   events before any system. Read `references/data-modeling.md`, and
   `references/relations.md` when entities point at each other or an entity
   has one state out of several.
3. **Write the systems.** One job each, an early return when there is nothing
   to do, shared steps in actions. Read `references/systems-and-queries.md`.
4. **Place them in the frame.** Pick a schedule for each system, then add
   ordering only where data flows between systems. Read
   `references/scheduling.md`.
5. **Test.** Run real systems on a real world for a frame or two, then check
   the data. Read `references/testing.md`.

Before inventing a mechanism, read `references/patterns.md`. It has recipes for
problems most applications meet: state machines, feature flags, objects that
live outside the world, syncing external data, injected services, and shared
spawn logic.

`references/api.md` lists every export in one place. Use it to find the right
function instead of guessing a name.

---

## A complete program

```ts
import {
  addResource,
  addSystem,
  addSystems,
  assertResource,
  collectEntities,
  createEntity,
  createWorld,
  defineComponent,
  defineSystem,
  First,
  getComponentValue,
  getResourceValue,
  run,
  setComponentValue,
  setResourceValue,
  Startup,
  Type,
} from "iris-ecs";

// Definitions live at module scope: names are unique across the process
const Position = defineComponent("Position", {
  schema: {
    // Pixels. A vector keeps both axes in one typed array
    value: Type.f32(2),
  },
});

const Velocity = defineComponent("Velocity", {
  schema: {
    // Pixels per second
    value: Type.f32(2),
  },
});

// A tag stores nothing; queries filter on its presence
const Asteroid = defineComponent("Asteroid");

// Used as a resource: one per world
const Time = defineComponent("Time", {
  schema: {
    // Seconds since the previous frame
    delta: Type.f32(),
    // A performance.now() timestamp, which outgrows f32 precision
    last: Type.f64(),
  },
});

const initTime = defineSystem("initTime", (world) => {
  addResource(world, Time, {
    delta: 0,
    last: performance.now(),
  });
});

const spawnAsteroids = defineSystem("spawnAsteroids", (world) => {
  for (let i = 0; i < 10; i++) {
    createEntity(world, [
      Asteroid,
      [Position, { value: [Math.random() * 800, Math.random() * 600] }],
      [Velocity, { value: [(Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60] }],
    ]);
  }
});

const tickTime = defineSystem("tickTime", (world) => {
  // A missing clock is a bug, so fail loudly. Also narrows reads to number
  assertResource(world, Time);

  const now = performance.now();
  const last = getResourceValue(world, Time, "last");

  setResourceValue(world, Time, "delta", (now - last) / 1000);
  setResourceValue(world, Time, "last", now);
});

const moveEntities = defineSystem("moveEntities", (world) => {
  assertResource(world, Time);

  const delta = getResourceValue(world, Time, "delta");

  // Results are narrowed to Position and Velocity, so reads need no checks
  for (const entity of collectEntities(world, [Position, Velocity])) {
    const [x, y] = getComponentValue(world, entity, Position, "value");
    const [vx, vy] = getComponentValue(world, entity, Velocity, "value");

    setComponentValue(world, entity, Position, "value", [x + vx * delta, y + vy * delta]);
  }
});

const world = createWorld();

// Startup runs once, in this order, before the first frame's pipeline
addSystems(world, [
  initTime,
  spawnAsteroids,
], { schedule: Startup });

// The clock ticks before anything reads it
addSystem(world, tickTime, { schedule: First });

// Update is the default schedule
addSystem(world, moveEntities);

// A requestAnimationFrame loop. Tests call runOnce(world) instead
run(world);
```

Every Iris program has this shape: data, systems that work on it, and a world
that runs them. Code outside systems creates the world, registers systems, and
hands input in as events.

---

## Not what you might assume

| You might reach for | In Iris |
|---|---|
| Methods: `world.spawn()`, `entity.add()`, `world.entity().set()` | Functions with `world` first: `createEntity(world, [...])`, `addComponent(world, entity, Health, { current: 100, max: 100 })` |
| Component classes, decorators, plain objects | `defineComponent("Health", { schema: { current: Type.i32(), max: Type.i32() } })`; a tag is `defineComponent("Dead")` |
| Column access such as `Position.x[eid]` | `getComponentValue` and `setComponentValue`; `getComponentView` plus `markComponentChanged` for hot vector loops |
| A command buffer or deferred commands | None. Every change applies at once. Loop over a `collectEntities` snapshot and change entities freely |
| A query object built once and kept | `collectEntities(world, terms)` inside the system on every run. Iris caches the query |
| A change filter that ignores the system's own writes | `changed(C)` sees every write since this system last read it, including its own writes made after the read |
| Events readable anywhere | `readEvents` works only in a running system, and each system has its own read position |
| A separate resource type | A resource is a component stored once: `addResource(world, Score, { value: 0 })` |
| A built-in `ChildOf` or hierarchy | Define it: `defineRelation("ChildOf", { exclusive: true, onDeleteTarget: "delete" })` |
| Built-in states such as `OnEnter` | An exclusive relation with tag targets; `added` and `removed` on the concrete pair mark enter and exit. See `references/patterns.md` |
| Observers or hooks for game logic | Systems that read events or use `added` and `changed`. Observers are for tooling |
| Priority numbers for system order | Schedules (`First`, `PreUpdate`, `Update`, `PostUpdate`, `Last`), then `before` and `after` |

---

## Behavior that fails silently

Each of these compiles, runs without an error, and does the wrong thing. They
are where Iris differs from other ECS libraries, so check new code against
them. Mistakes that throw are in the next section.

1. **`added`, `changed`, and event reads see nothing outside a running
   system.** That includes setup code, conditions, and tests between frames.
   A condition that reads an event never passes.
2. **Each read consumes what it saw.** A second identical `changed` query or
   event read in the same system returns nothing. Read once and keep the
   result.
3. **A system's first run sees everything.** Every existing component counts as
   added and changed, so a reaction system fires for the whole world once.
4. **`addComponent` and `addResource` never overwrite.** Adding what is already
   there keeps the old values. Write with `setComponentValue`, `setComponent`,
   `setResourceValue`, or `setResource`.
5. **Writes to an absent component do nothing**, and reads return `undefined`.
   Narrow first with a query, `hasComponent`, or `assertComponent`.
6. **Every write marks a change**, even with the same value. Compare before
   writing when `changed` drives expensive work.
7. **Writes through `getComponentView` are invisible to `changed`** until you
   call `markComponentChanged`, and the view goes stale at the next structural
   change.
8. **Events expire after the frame following their emission.** A system that
   skips a frame misses them. Keep state that must last in a component or a
   resource.
9. **Structural changes inside an `EXPERIMENTAL_queryEntities` callback corrupt
   the iteration.** `collectEntities` returns a snapshot, so loops over it may
   change anything.

---

## Common errors

| Error | Usual cause | Fix |
|---|---|---|
| `IrisDuplicateDefinition` | A definition inside a function, a test, or a module that runs twice | Move it to module scope, or give it a unique name |
| `IrisEntityNotFound` | Using an ID after its entity was destroyed | Check `isEntityAlive` first; IDs from events, fields, and earlier frames may be stale |
| `IrisComponentNotFound`, `IrisResourceNotFound` | `assertComponent` or `assertResource` on missing data | Add it in a `Startup` system, or use `hasComponent` and `hasResource` if it is optional |
| `IrisInvalidQuery` | A query with no required term, e.g. only `not(X)` | Add at least one component the entities must have |
| `IrisInvalidPair` | Adding or removing a pair with `Wildcard` | Add the concrete `pair(Relation, target)`. Wildcards are for queries only |
| `IrisDuplicateSystem` | Registering the same system twice | Register once, or pass a distinct `name` |
| `IrisSystemNotFound` | `before` or `after` names a system in another schedule, or one never added | Order within one schedule, or order the schedules |
| `IrisCircularDependency` | `before` and `after` form a cycle | Remove a constraint, or split the work across schedules |
| `IrisSchedulerBusy` | `resetWorld` or `runOnce` while `run` is active | `await stop(world)` or `await suspend(world)` first |

Every error extends `IrisError`. The JSDoc of each function lists what it throws.
