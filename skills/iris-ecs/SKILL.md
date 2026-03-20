---
name: iris-ecs
description: >-
  How to write correct, performant code using the iris-ecs Entity Component System library.
  Use this skill whenever the user is working with iris-ecs, writing ECS systems, defining
  components/tags/relations, querying entities, or building any application with iris-ecs,
  even if they don't explicitly mention the skill name. Trigger on imports from "iris-ecs",
  mentions of ECS patterns (entities, components, systems, archetypes), or any code that
  uses iris-ecs APIs like createWorld, defineComponent, queryEntities, etc.
metadata:
  tags: ecs, entity-component-system, typescript, game-engine, iris, iris-ecs
---

# iris-ecs

A high-performance Entity Component System for TypeScript. Purely functional API: all operations are free functions that take `world` as the first argument.

Import everything from `"iris-ecs"`.

## Quick Start

```typescript
import {
  createWorld, createEntity, defineComponent, defineSystem,
  addComponent, getComponentValue, setComponentValue,
  cacheQuery, queryEntities, addSystem, run, Type,
} from "iris-ecs";

const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });
const Velocity = defineComponent("Velocity", { x: Type.f32(), y: Type.f32() });

const movementSystem = defineSystem("movementSystem", (world) => {
  const movers = cacheQuery(world, Position, Velocity);

  return () => {
    queryEntities(world, movers, (e) => {
      setComponentValue(world, e, Position, "x",
        getComponentValue(world, e, Position, "x")! + getComponentValue(world, e, Velocity, "x")!);
      setComponentValue(world, e, Position, "y",
        getComponentValue(world, e, Position, "y")! + getComponentValue(world, e, Velocity, "y")!);
    });
  };
});

const world = createWorld();
const player = createEntity(world);
addComponent(world, player, Position, { x: 0, y: 0 });
addComponent(world, player, Velocity, { x: 1, y: 0 });
addSystem(world, movementSystem);
run(world); // starts a requestAnimationFrame loop
```

## Concepts

- **World** - Container for all ECS state. Created with `createWorld()`. Passed as first argument to every operation. No globals, no singletons.
- **Entity** - A unique 32-bit identifier. Has no data of its own, just an ID for attaching components. Created with `createEntity(world)`.
- **Component** - Typed data attached to an entity. Defined with a schema of typed fields (e.g., `{ x: Type.f32(), y: Type.f32() }`). Numeric fields use TypedArrays for cache-friendly columnar storage.
- **Tag** - A component with no data. Lightweight marker for filtering entities (e.g., `Dead`, `Player`, `Selected`). Defined with `defineTag("Name")`.
- **Resource** - World-level shared state. The correct way to store global data. Do NOT use module-level variables or system-local state for data that other systems need to read. Managed with `addResource` / `getResourceValue` / `setResourceValue`.
- **Archetype** - Internal grouping of entities sharing the same component set. Adding / removing components moves entities between archetypes (expensive). Reading / writing component values is cheap (direct TypedArray access).
- **Query** - Fetches entities matching component constraints. Supports exclusion with `not()`. Cache queries in system init with `cacheQuery()`.
- **Change Detection** - Track entity changes between system runs. `added()` and `changed()` are query modifiers. `removed()` returns an Event (read with `readEvents`). ONLY works inside system execution context.
- **System** - A function that operates on the world each frame. Uses init / tick separation: init runs once (cache queries here), tick runs every frame. Defined with `defineSystem()`.
- **Schedule** - Named execution phase. Default pipeline: `First` > `PreUpdate` > `Update` > `PostUpdate` > `Last`. Plus `Startup` (runs once before first frame) and `Shutdown` (runs once on `stop()`).
- **Relation** - A directed connection between two entities. `pair(relation, target)` encodes a relation into a Pair, which acts like a component: added / removed / queried with `addComponent`, `hasComponent`, `queryEntities`. Supports wildcards, exclusive mode, and cascade deletion.
- **Event** - Ephemeral message for inter-system communication. Double-buffered, survives one full frame, then discarded. Each system tracks consumption independently.
- **Observer** - Low-level lifecycle callback (`entityCreated`, `componentAdded`, etc.). For debugging, editor integration, and internal framework plumbing, not game logic.
- **Action** - Cached, world-bound operation bundle. Define reusable spawn helpers or update batches once, call without passing world repeatedly.

## Rules

Each rule file covers one concept. Load the relevant file for the task at hand. Do not load all files at once.

- [world.md](./rules/world.md) - World lifecycle: `createWorld`, `resetWorld`
- [entities.md](./rules/entities.md) - Entity lifecycle: `createEntity`, `destroyEntity`, `isEntityAlive`, ID recycling, 32-bit encoding
- [naming.md](./rules/naming.md) - Entity names: `setName`, `getName`, `removeName`, `lookupByName`
- [schema.md](./rules/schema.md) - Schema types: `Type.f32()`, `Type.i32()`, `Type.u32()`, `Type.bool()`, `Type.string()`, `Type.object()`, TypedArray mapping, schema design
- [components.md](./rules/components.md) - Components: `defineComponent`, `addComponent`, `removeComponent`, `hasComponent`, `getComponentValue`, `setComponentValue`, `markComponentChanged`
- [tags.md](./rules/tags.md) - Tags: `defineTag`, tag patterns, when to use tags vs. components
- [resources.md](./rules/resources.md) - Resources (global state): `addResource`, `removeResource`, `hasResource`, `getResourceValue`, `setResourceValue`
- [queries.md](./rules/queries.md) - Queries and filters: `queryEntities`, `queryFirstEntity`, `collectEntities`, `cacheQuery`, `not()`
- [change-detection.md](./rules/change-detection.md) - Change detection: `added()`, `changed()`, `removed()`, system context requirement
- [systems.md](./rules/systems.md) - Systems: `defineSystem`, `addSystem`, init/tick separation, `before`/`after` ordering, plain function systems
- [scheduling.md](./rules/scheduling.md) - Schedules and execution: `First`/`PreUpdate`/`Update`/`PostUpdate`/`Last`/`Startup`/`Shutdown`, `defineSchedule`, `insertScheduleBefore`/`After`, `run`, `runOnce`, `stop`
- [relations.md](./rules/relations.md) - Relations, pairs, wildcards: `defineRelation`, `pair`, `getPairRelation`, `getPairTarget`, `getRelationTargets`, `Wildcard`, exclusive relations, cascade deletion, data relations
- [events.md](./rules/events.md) - Events: `defineEvent`, `emitEvent`, `readEvents`, `collectEvents`, `readLastEvent`, `hasEvents`, `countEvents`, `clearEvents`
- [observers.md](./rules/observers.md) - Observers: `registerObserverCallback`, `unregisterObserverCallback`, lifecycle event types
- [actions.md](./rules/actions.md) - Actions: `defineActions`, cached closures, system integration
