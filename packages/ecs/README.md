# iris-ecs

Entity Component System implementation for TypeScript.

> **Early stage implementation.** APIs are unstable and breaking changes can happen between versions.

## What is ECS?

**Entity Component System** is a design pattern that separates *identity*, *data*, and *behavior*:

- **Entities** are unique identifiers -- just IDs
- **Components** are plain data attached to entities
- **Systems** are functions that query and process entities by their components

A player can be an entity with `Position`, `Health`, and `PlayerInput` components. A tree might be an entity with `Position` and `Sprite`. A movement system queries all entities with `Position` and `Velocity` -- it doesn't care if they're players, enemies, or projectiles.

This shifts how you model problems: instead of asking "what *type* is this object?", you ask "what *components* does this entity have?" Components can be added and removed at runtime, so entities gain and lose capabilities dynamically.

### When to use ECS

ECS works well when you have **many entities sharing overlapping behaviors**. Games are the classic example: bullets, enemies, particles, and players all need position updates, but only some need AI, only some need player input, only some render sprites. A system that moves things doesn't need to know about rendering; a system that renders doesn't need to know about AI.

ECS also fits **simulations** (agent-based models, traffic flow, ecosystems), **editors** (level editors, graphics tools with many selectable/transformable objects), and **interactive visualizations** with many updatable elements.

ECS is not a good fit for everything. Simple CRUD applications, form-heavy UIs, or problems where you have few entities with complex, unique behaviors may be better served by straightforward objects or state management libraries.

## Install

```bash
npm install iris-ecs
```

## AI Skills

Install the [iris-ecs skill](https://skills.sh) so AI coding agents (Claude Code, Cursor, etc.) understand the iris-ecs API:

```bash
npx skills add https://github.com/r04423/iris --skill iris-ecs
```

## Quick Start

```typescript
import {
  createWorld,
  createEntity,
  defineComponent,
  defineSystem,
  defineTag,
  cacheQuery,
  getComponentVectorView,
  queryEntities,
  addSystem,
  runOnce,
  Type,
} from "iris-ecs";

// Define components -- vector fields store x,y interleaved in one TypedArray
const Position = defineComponent("Position", { value: Type.f32(2) });
const Velocity = defineComponent("Velocity", { value: Type.f32(2) });
const Player = defineTag("Player");

// Create world and entities
const world = createWorld();

const player = createEntity(world, [
  [Position, { value: [0, 0] }],
  [Velocity, { value: [1, 0] }],
  Player,
]);

// Define a system -- init runs once, tick runs every frame
const movementSystem = defineSystem("movementSystem", (world) => {
  // Init: cache queries once
  const movers = cacheQuery(world, [Position, Velocity]);

  return () => {
    // Tick: runs every frame
    queryEntities(world, movers, (e) => {
      const pos = getComponentVectorView(world, e, Position, "value");
      const vel = getComponentVectorView(world, e, Velocity, "value");

      pos[0] += vel[0];
      pos[1] += vel[1];
    });
  };
});

// Register and run
addSystem(world, movementSystem);
await runOnce(world);

// Position is now [1, 0]
```

## Core Concepts

### Entities

An **Entity** is a unique identifier representing a thing in your world. Entities have no data of their own -- they're containers for components.

```typescript
import {
  createWorld,
  createEntity,
  destroyEntity,
  isEntityAlive,
  resetWorld,
} from "iris-ecs";

const world = createWorld();

const player = createEntity(world);
const enemy = createEntity(world);

// Create with initial components
const npc = createEntity(world, [
  [Position, { value: [10, 20] }],
  Enemy,
]);

destroyEntity(world, enemy);
isEntityAlive(world, enemy); // false
isEntityAlive(world, player); // true

// Clear all entities and state, keeping component/tag definitions
resetWorld(world);
```

Create entities with `createEntity()`, optionally passing an array of component entries to attach in one call. Destroy them with `destroyEntity()`. Use `isEntityAlive()` to check if an entity reference is still valid. Call `resetWorld()` to clear all entities and state while preserving definitions -- useful for level reloads or testing.

⚠️ **Entity IDs are recycled.** After destroying an entity, its ID may be reused for a new entity. Never store entity IDs long-term without checking `isEntityAlive()` first -- your old reference might now point to a different entity.

#### Everything is an Entity

Components, tags, and relations are also entities internally. When you call `defineComponent()` or `defineTag()`, you're creating a special entity that can be attached to other entities. This unified model means components can have components, enabling patterns like adding metadata to component types.

All IDs are 32-bit encoded values with type bits distinguishing entities (0x1), tags (0x2), components (0x3), and relations (0x4). Entity IDs include an 8-bit generation counter for stale reference detection -- when an ID is recycled, its generation increments, invalidating old references.

#### Entity Names

Entities can be given human-readable names for debugging and lookup. Names must be unique within a world.

```typescript
import { setName, getName, removeName, lookupByName } from "iris-ecs";

setName(world, player, "player-1");
getName(world, player);              // "player-1"
lookupByName(world, "player-1");     // player entity

// Validate components during lookup -- returns entity only if it has both
lookupByName(world, "player-1", [Position, Health]);

removeName(world, player);
lookupByName(world, "player-1");     // undefined
```

Names are automatically cleaned up when entities are destroyed. Use names for integrations, save/load systems, or any scenario where you need to reference entities by string identifier.

💡 **Tip:** Names are great for debugging -- use `setName()` on important entities to make logs more readable.

### Tags

A **Tag** is a marker component with no data.

```typescript
import { defineTag, addComponent, hasComponent, removeComponent } from "iris-ecs";

const Player = defineTag("Player");
const Enemy = defineTag("Enemy");
const Poisoned = defineTag("Poisoned");

addComponent(world, entity, Player);
hasComponent(world, entity, Player);  // true

removeComponent(world, entity, Player);
hasComponent(world, entity, Player);  // false
```

Tags are lightweight -- they only affect which archetype an entity belongs to. Use tags when you need to filter entities but don't need associated data.

### Components

A **Component** holds typed data attached to an entity. Define components with a schema specifying field names and types.

```typescript
import {
  defineComponent,
  Type,
  addComponent,
  addComponents,
  getComponentValue,
  setComponentValue,
  getComponentVectorValue,
  setComponentVectorValue,
  getComponentVectorView,
} from "iris-ecs";

const Position = defineComponent("Position", { value: Type.f32(2) });
const Health = defineComponent("Health", { current: Type.i32(), max: Type.i32() });

addComponent(world, entity, Position, { value: [0, 0] });
addComponent(world, entity, Health, { current: 100, max: 100 });

// Scalar fields use getComponentValue / setComponentValue
const hp = getComponentValue(world, entity, Health, "current");  // 100
setComponentValue(world, entity, Health, "current", 80);

// Vector fields use dedicated access functions
const pos = getComponentVectorView(world, entity, Position, "value");  // Float32Array [0, 0]
```

#### Schema Types

The `Type` namespace provides storage-optimized types:

| Type | Storage | Use case |
|------|---------|----------|
| `Type.f32<T>()` | Float32Array | Positions, velocities, normalized values |
| `Type.f64<T>()` | Float64Array | High-precision calculations |
| `Type.i8<T>()` | Int8Array | Small signed integers (-128 to 127) |
| `Type.i16<T>()` | Int16Array | Medium signed integers |
| `Type.i32<T>()` | Int32Array | Entity counts, scores, health |
| `Type.u32<T>()` | Uint32Array | Unsigned integers, bit flags |
| `Type.bool<T>()` | Array | Boolean flags |
| `Type.string<T>()` | Array | Text data |
| `Type.ref<T>()` | Array | Object references, arrays, Maps, Sets, class instances |

All numeric type factories accept an optional size parameter (2-16) to create **vector fields** -- see [Vector Fields](#vector-fields) below.

Numeric types use TypedArrays for cache-friendly memory layout. Use the smallest type that fits your data.

#### Adding Components is Idempotent

Adding a component that already exists does nothing -- the existing data is preserved.

```typescript
addComponent(world, entity, Health, { current: 100, max: 100 });
addComponent(world, entity, Health, { current: 50, max: 50 });  // ignored

getComponentValue(world, entity, Health, "current");  // still 100
```

💡 **Tip:** Use `hasComponent()` to check first if you need conditional addition, or `setComponentValue()` to update existing data.

#### Batch Adding Components

Use `addComponents()` to attach multiple components in one call:

```typescript
addComponents(world, entity, [
  [Position, { value: [0, 0] }],
  [Velocity, { value: [1, 0] }],
  Player,
]);
```

Each entry is either a standalone ID (tag, entity, schema-less pair) or a `[component, data]` tuple for data components.

#### Vector Fields

When component fields represent logically grouped numbers (positions, colors, directions), use **vector fields** to store them interleaved in a single TypedArray column. Pass a size (2-16) to any numeric type factory:

```typescript
import {
  defineComponent,
  addComponent,
  getComponentVectorValue,
  setComponentVectorValue,
  getComponentVectorView,
  Type,
} from "iris-ecs";

const Position = defineComponent("Position", { value: Type.f32(2) });
const Color = defineComponent("Color", { value: Type.u32(4) });

const entity = createEntity(world);
addComponent(world, entity, Position, { value: [10, 20] });
addComponent(world, entity, Color, { value: [255, 128, 0, 255] });
```

Vector fields use dedicated access functions instead of the scalar `getComponentValue` / `setComponentValue`:

```typescript
// Copy-based read -- returns a tuple (e.g., [number, number])
const pos = getComponentVectorValue(world, entity, Position, "value");

// Copy-based write
setComponentVectorValue(world, entity, Position, "value", [30, 40]);

// Zero-copy view -- returns a TypedArray subarray backed by the column buffer
const view = getComponentVectorView(world, entity, Position, "value");
view[0] += 1.0; // direct mutation, no copy
```

The zero-copy view shares the underlying buffer -- mutations are immediate. Views are invalidated if the archetype resizes (when new entities are added and capacity grows). Use views within a system tick; do not cache across frames.

Components can mix scalar and vector fields:

```typescript
const Particle = defineComponent("Particle", {
  position: Type.f32(3),
  mass: Type.f32(),
});

addComponent(world, entity, Particle, { position: [0, 0, 0], mass: 1.0 });

const mass = getComponentValue(world, entity, Particle, "mass");            // number
const pos = getComponentVectorValue(world, entity, Particle, "position");   // [number, number, number]
```

TypeScript enforces the scalar/vector boundary at the type level -- `getComponentValue` rejects vector fields, and `getComponentVectorValue` rejects scalar fields.

### Resources

A **Resource** is a global singleton -- world-level data that isn't attached to any specific entity. Define resources using regular components and store them with `addResource()`.

```typescript
import {
  defineComponent,
  addResource,
  getResourceValue,
  setResourceValue,
  hasResource,
  removeResource,
  Type,
} from "iris-ecs";

const Time = defineComponent("Time", { delta: Type.f32(), elapsed: Type.f32() });

addResource(world, Time, { delta: 0.016, elapsed: 0 });

// Read and write resource values
const dt = getResourceValue(world, Time, "delta");    // 0.016
setResourceValue(world, Time, "elapsed", 1.5);

// Check existence and remove
if (hasResource(world, Time)) {
  removeResource(world, Time);
}
```

Resources use the **component-on-self pattern** internally -- the component is added to itself as an entity. This means resources appear in queries:

```typescript
queryEntities(world, [Time], (entity) => {
  // entity === Time (the component ID itself)
});
```

Use resources for frame timing, configuration, asset registry, input state, physics settings, or any global data that systems need but doesn't belong to a specific entity.

Resources with vector fields use dedicated access functions, mirroring the component vector API:

```typescript
import {
  defineComponent,
  addResource,
  getResourceVectorValue,
  setResourceVectorValue,
  getResourceVectorView,
  Type,
} from "iris-ecs";

const Gravity = defineComponent("Gravity", { value: Type.f64(3) });
addResource(world, Gravity, { value: [0, -9.81, 0] });

// Copy-based read
const g = getResourceVectorValue(world, Gravity, "value"); // [number, number, number]

// Copy-based write
setResourceVectorValue(world, Gravity, "value", [0, -20, 0]);

// Zero-copy view
const view = getResourceVectorView(world, Gravity, "value"); // Float64Array
view[1] = -15; // direct mutation
```

### Relations

A **Relation** describes a directed connection between two entities. Combine a relation with a target using `pair()` to create a pair -- pairs are added to entities like components.

```typescript
import {
  defineRelation,
  pair,
  addComponent,
  queryEntities,
  getRelationTargets,
  Wildcard,
} from "iris-ecs";

const ChildOf = defineRelation("ChildOf");

const scene = createEntity(world);
const player = createEntity(world);
const weapon = createEntity(world);

addComponent(world, player, pair(ChildOf, scene));
addComponent(world, weapon, pair(ChildOf, player));

// Query children of a specific parent
queryEntities(world, [pair(ChildOf, scene)], (child) => {
  // child === player
});

// Get all targets for a relation on an entity
const parents = getRelationTargets(world, weapon, ChildOf); // [player]
```

Use relations for hierarchies (parent/child), ownership, targeting, dependencies, or any directed graph structure.

#### Wildcard Queries

Use `Wildcard` to match any relation or target:

```typescript
import { collectEntities } from "iris-ecs";

// All entities with ANY ChildOf relation (any target)
const allChildren = collectEntities(world, [pair(ChildOf, Wildcard)]);

// All entities targeting a specific entity (any relation)
const relatedToPlayer = collectEntities(world, [pair(Wildcard, player)]);
```

#### Exclusive Relations

An **exclusive** relation allows only one target per entity. Adding a new pair automatically removes the previous one.

```typescript
const ChildOf = defineRelation("ChildOf", { exclusive: true });

addComponent(world, entity, pair(ChildOf, parent1));
addComponent(world, entity, pair(ChildOf, parent2)); // removes parent1

getRelationTargets(world, entity, ChildOf); // [parent2]
```

#### Cascade Deletion

By default, destroying a target entity removes pairs pointing to it but leaves subjects alive. Use `onDeleteTarget: "delete"` to cascade-delete subjects when the target is destroyed.

```typescript
const ChildOf = defineRelation("ChildOf", { onDeleteTarget: "delete" });

const parent = createEntity(world);
const child = createEntity(world);
addComponent(world, child, pair(ChildOf, parent));

destroyEntity(world, parent);
isEntityAlive(world, child); // false -- cascaded
```

#### Data Relations

Relations can carry data, just like components:

```typescript
const Targets = defineRelation("Targets", {
  schema: { priority: Type.i8() },
});

addComponent(world, turret, pair(Targets, enemy), { priority: 10 });

const p = pair(Targets, enemy);
const priority = getComponentValue(world, turret, p, "priority");
```

### Archetypes (Under the Hood)

An **Archetype** groups entities that share the same component set. All entities with `Position` and `Velocity` live in one archetype; entities with `Position`, `Velocity`, and `Health` live in another.

```
Archetype [Position, Velocity]
┌─────────┬──────────────────┬──────────────────┐
│ Entity  │ Position (vec2)  │ Velocity (vec2)  │
├─────────┼──────────────────┼──────────────────┤
│ bullet1 │  [10, 5]         │  [1, 0]          │
│ bullet2 │  [15, 8]         │  [1, 0]          │
└─────────┴──────────────────┴──────────────────┘

Archetype [Position, Velocity, Health]
┌─────────┬──────────────────┬──────────────────┬─────────┐
│ Entity  │ Position (vec2)  │ Velocity (vec2)  │ Health  │
├─────────┼──────────────────┼──────────────────┼─────────┤
│ player  │  [0, 0]          │  [1, 0]          │   100   │
│ enemy   │  [50, 20]        │  [-1, 0]         │    50   │
└─────────┴──────────────────┴──────────────────┴─────────┘
```

Vector fields like Position store all elements interleaved in a single TypedArray column: `[x0, y0, x1, y1, ...]`. This keeps each entity's vector contiguous in memory for cache-friendly access.

Within an archetype, component data is stored in **columns** (TypedArrays for numeric types, Arrays for primitives and references). When a query iterates entities with `Position` and `Velocity`, it walks through archetypes that contain both components. This columnar layout keeps data contiguous rather than scattered across objects, reducing memory overhead and enabling efficient iteration.

Adding or removing a component moves an entity to a different archetype. This is more expensive than reading or writing component values, so prefer stable component sets for entities that update frequently.

💡 **Tip:** You don't interact with archetypes directly -- the ECS handles them automatically. Understanding the model helps you design components that group well and avoid unnecessary archetype transitions.

### Queries

A **Query** fetches entities that match a set of component constraints. Use `queryEntities()` to iterate matches, `queryFirstEntity()` for singletons, or `collectEntities()` for array results.

```typescript
import { queryEntities, queryFirstEntity, cacheQuery, not } from "iris-ecs";

// Iterate all entities with Position and Velocity
queryEntities(world, [Position, Velocity], (entity) => {
  const pos = getComponentVectorView(world, entity, Position, "value")!;
  // ...
});

// Get a singleton (first match or undefined)
const player = queryFirstEntity(world, [Player, not(Dead)]);
```

Inline terms (arrays) work anywhere, but in systems it's advised to pre-build queries with `cacheQuery()` during init:

```typescript
const mySystem = defineSystem("mySystem", (world) => {
  const movers = cacheQuery(world, [Position, Velocity]);

  return () => {
    queryEntities(world, movers, (entity) => {
      // ...
    });
  };
});
```

💡 **Tip:** Queries are cached internally -- the same component set returns the same cached query. `cacheQuery()` in init makes the caching explicit and avoids array allocation on every frame.

#### Exclusion Filters

Use `not()` to exclude entities that have a component:

```typescript
// All entities with Position but WITHOUT the Dead tag
queryEntities(world, [Position, not(Dead)], (entity) => {
  // Only living entities
});

// Multiple exclusions
queryEntities(world, [Position, Velocity, not(Frozen), not(Disabled)], (entity) => {
  // Entities that can move
});
```

#### Filters and Archetypes (Under the Hood)

Queries match archetypes where all required components are present and no excluded components exist. Matched archetypes are cached and auto-update when archetypes are created or destroyed.

#### Column Iteration

For performance-critical systems, `queryColumns()` provides direct access to the underlying TypedArray columns instead of iterating entity-by-entity. The callback receives the entity array and a columns tuple for each matching archetype. Each element in the tuple corresponds to a data-bearing component in query term order:

```typescript
import { queryColumns, cacheQuery, not } from "iris-ecs";

queryColumns(world, [Player, Position, Velocity, not(Dead)], (entities, [pos, vel]) => {
  // pos.value and vel.value are raw TypedArrays (e.g. Float32Array)
  // entities.length tells you how many entities are in this archetype
  for (let i = 0; i < entities.length; i++) {
    const offset = i * 2; // vec2 stride
    pos.value[offset] += vel.value[offset];
    pos.value[offset + 1] += vel.value[offset + 1];
  }
});
```

Tags and data-less pairs are omitted from the columns tuple -- only data-bearing components and relation pairs appear as elements. The element order matches the order of data-bearing terms in the query.

Pre-cached queries work the same way:

```typescript
const movementSystem = defineSystem("movementSystem", (world) => {
  const movers = cacheQuery(world, [Position, Enemy, Velocity, not(Frozen)]);

  return () => {
    queryColumns(world, movers, (entities, [pos, vel]) => {
      for (let i = 0; i < entities.length; i++) {
        const offset = i * 2;
        pos.value[offset] += vel.value[offset];
        pos.value[offset + 1] += vel.value[offset + 1];
      }
    });
  };
});
```

Return `false` from the callback to stop iteration early (same as `queryEntities`).

`queryColumns` does not support `added()` or `changed()` modifiers -- use `queryEntities` for change detection.

💡 **Tip:** Use `queryColumns` when you need to process large numbers of entities with tight loops over TypedArray data. Use `queryEntities` for entity-level logic, change detection, or when you need per-entity API calls like `getComponentValue`.

### Systems

A **System** is a function that operates on the world. Systems query entities, read and write components, emit events, and implement game logic.

Use `defineSystem()` to create systems with init / tick separation. The init function runs once at registration time -- use it to cache queries with `cacheQuery()`, cache action getters, and perform one-time setup. The returned tick function runs every frame.

Systems are registered with `addSystem()` and executed automatically when the world runs.

```typescript
import {
  defineSystem,
  cacheQuery,
  addSystem,
  run,
  stop,
  queryEntities,
  getComponentVectorView,
  getResourceValue,
} from "iris-ecs";

const movementSystem = defineSystem("movementSystem", (world) => {
  // Init: cache queries and action getters once
  const movers = cacheQuery(world, [Position, Velocity]);

  return () => {
    // Tick: runs every frame
    const dt = getResourceValue(world, Time, "delta") ?? 0;

    queryEntities(world, movers, (e) => {
      const pos = getComponentVectorView(world, e, Position, "value");
      const vel = getComponentVectorView(world, e, Velocity, "value");

      pos[0] += vel[0] * dt;
      pos[1] += vel[1] * dt;
    });
  };
});

addSystem(world, movementSystem);
run(world);

// ... later
await stop(world);
```

#### Plain Function Systems

For simple systems that don't need one-time setup, plain functions also work, and the function's name becomes the system identifier.

```typescript
function debugSystem(world) {
  queryEntities(world, [Health], (e) => {
    console.log(getComponentValue(world, e, Health, "current"));
  });
}

addSystem(world, debugSystem);
```

#### Ordering Constraints

Control execution order with `before` and `after` options:

```typescript
const inputSystem = defineSystem("inputSystem", (world) => {
  return () => { /* read input */ };
});
const physicsSystem = defineSystem("physicsSystem", (world) => {
  return () => { /* simulate physics */ };
});
const renderSystem = defineSystem("renderSystem", (world) => {
  return () => { /* draw frame */ };
});

addSystem(world, inputSystem);
addSystem(world, physicsSystem, { after: "inputSystem" });
addSystem(world, renderSystem, { after: "physicsSystem" });
// Executes: inputSystem -> physicsSystem -> renderSystem
```

Without constraints, systems run in registration order. Use arrays for multiple constraints: `{ after: ["inputSystem", "audioSystem"] }`.

`defineSystem` factory can be registered multiple times with different names via the `name` option: `addSystem(world, movementSystem, { name: "lateMovement" })`.

#### System Sets

**System sets** are named groups for ordering entire groups of systems relative to each other. Instead of wiring individual `before`/`after` between every physics and render system, declare the group-level constraint once:

```typescript
import { defineSystemSet, addSystemSet, addSystem } from "iris-ecs";

const PhysicsSystems = defineSystemSet("PhysicsSystems");
const RenderSystems = defineSystemSet("RenderSystems");

addSystemSet(world, PhysicsSystems, { before: RenderSystems });
addSystemSet(world, RenderSystems);

addSystem(world, applyGravity, { set: PhysicsSystems });
addSystem(world, detectCollisions, { set: PhysicsSystems, after: applyGravity });
addSystem(world, drawSprites, { set: RenderSystems });
addSystem(world, drawParticles, { set: RenderSystems });
// All physics systems run before all render systems
```

Systems within a set still respect their own `before`/`after` constraints. A system can also order itself relative to a set without joining it:

```typescript
addSystem(world, debugOverlay, { after: PhysicsSystems, before: RenderSystems });
```

A system uses either `schedule` or `set`, not both -- the set inherits its schedule from `addSystemSet`.

#### Schedules

Systems are grouped into **schedules** -- named execution phases. The default pipeline runs these schedules every frame:

```
First -> PreUpdate -> Update -> PostUpdate -> Last
```

`Update` is the default schedule. Assign systems to other phases based on when they should run:

```typescript
import { addSystem, First, PreUpdate, PostUpdate, Last, run, stop } from "iris-ecs";

addSystem(world, inputSystem, { schedule: First });
addSystem(world, physicsSystem, { schedule: PreUpdate });
addSystem(world, movementSystem); // defaults to Update
addSystem(world, collisionSystem, { schedule: PostUpdate });
addSystem(world, renderSystem, { schedule: Last });

run(world);

// ... later
await stop(world);
```

Two additional schedules run outside the main loop:

- **Startup** runs once before the first frame (asset loading, initialization)
- **Shutdown** runs once when `stop()` is called (cleanup, save state)

```typescript
import { Startup, Shutdown } from "iris-ecs";

addSystem(world, loadAssetsSystem, { schedule: Startup });
addSystem(world, saveGameSystem, { schedule: Shutdown });
```

#### Custom Schedules

Create custom pipeline phases with `defineSchedule()` and insert them relative to existing ones:

```typescript
import { defineSchedule, insertScheduleAfter, PreUpdate } from "iris-ecs";

const Physics = defineSchedule("Physics");
insertScheduleAfter(world, Physics, PreUpdate);
addSystem(world, gravitySystem, { schedule: Physics });

// Pipeline is now: First -> PreUpdate -> Physics -> Update -> PostUpdate -> Last
```

#### Running the World

`run(world)` starts a `requestAnimationFrame` loop. Each frame runs all pipeline schedules then flushes events. `stop(world)` stops the loop and runs Shutdown. Calling `stop()` then `run()` again re-triggers Startup and Shutdown for each cycle.

For manual frame stepping (tests, server-side), use `runOnce()`:

```typescript
import { runOnce } from "iris-ecs";

await runOnce(world); // one frame
```

#### Async Systems

Systems can be async. Both `run()` and `runOnce()` handle sync and async systems transparently:

```typescript
const loadAssetsSystem = defineSystem("loadAssetsSystem", (world) => {
  return async () => {
    const textures = await fetch("/assets/textures.json");
    // ...
  };
});

addSystem(world, loadAssetsSystem, { schedule: Startup });
```

### Actions

**Actions** bundle reusable operations with a world captured in closure. Define actions once, then call them without repeatedly passing the world.

```typescript
import { defineActions, createEntity } from "iris-ecs";

const spawnActions = defineActions((world) => ({
  player(x: number, y: number) {
    return createEntity(world, [
      [Position, { value: [x, y] }],
      Player,
    ]);
  },
  enemy(x: number, y: number) {
    return createEntity(world, [
      [Position, { value: [x, y] }],
      Enemy,
    ]);
  },
}));

// Cache the action getter in a system's init, then call in tick
const waveSystem = defineSystem("waveSystem", (world) => {
  const spawn = spawnActions(world);

  return () => {
    spawn.enemy(Math.random() * 100, 0);
  };
});
```

Actions are initialized lazily and cached per world -- calling `spawnActions(world)` multiple times returns the same object. Cache the getter in your system's init to avoid repeated lookups in the tick function.

💡 **Tip:** Use actions to organize spawn helpers, update functions, or any reusable world operations.

### Events

An **Event** is an ephemeral message for communication between systems. Unlike components (persistent data on entities), events are fire-and-forget: emit once, consume once per system, then gone.

```typescript
import { defineEvent, emitEvent, readEvents, Type } from "iris-ecs";

// Tag event (no data)
const GameStarted = defineEvent("GameStarted");

// Data event
const DamageDealt = defineEvent("DamageDealt", {
  target: Type.u32(),
  amount: Type.f32(),
});

// Emit events
emitEvent(world, GameStarted);
emitEvent(world, DamageDealt, { target: enemy, amount: 25 });

// Consume events in a system
function damageSystem(world) {
  readEvents(world, DamageDealt, (event) => {
    applyDamage(event.target, event.amount);
  });
}
```

Use events when systems need to react to something that happened without polling entity state. Common patterns: collision notifications, input events, game state transitions.

#### Per-System Isolation

Each system independently tracks which events it has consumed. Multiple systems can read the same events:

```typescript
function uiSystem(world) {
  readEvents(world, DamageDealt, (e) => {
    showDamageNumber(e.target, e.amount);
  });
}

function audioSystem(world) {
  readEvents(world, DamageDealt, (e) => {
    playHitSound(e.amount);
  });
}

// Both systems see the same DamageDealt events
```

#### Event Utilities

```typescript
import {
  hasEvents,
  countEvents,
  readLastEvent,
  clearEvents,
} from "iris-ecs";

// Check without consuming
if (hasEvents(world, DamageDealt)) {
  const count = countEvents(world, DamageDealt);
}

// Get only the most recent event (marks all as read)
const lastInput = readLastEvent(world, InputChanged);

// Skip events without processing
if (isPaused) {
  clearEvents(world, DamageDealt);
  return;
}
```

#### Event Lifetime

Events use double-buffered storage. Buffers rotate automatically at the end of each frame -- events survive one frame (so systems that run next frame can still read them), then are discarded. Calling `readEvents()` marks events as read for that system -- a second call in the same system sees nothing new.

⚠️ **Events are not entities.** Unlike components and tags, events exist outside the entity-component model. You cannot query for events or attach them to entities.

### Change Detection

**Change detection** tracks when components are added, modified, or removed, letting systems process only what changed since their last run.

```typescript
import {
  defineSystem,
  cacheQuery,
  queryEntities,
  readEvents,
  added,
  changed,
  removed,
  not,
} from "iris-ecs";

const physicsSetupSystem = defineSystem("physicsSetupSystem", (world) => {
  const newBodies = cacheQuery(world, [added(Position)]);

  return () => {
    // Entities where Position was added since this system's last run
    queryEntities(world, newBodies, (entity) => {
      initializePhysicsBody(entity);
    });
  };
});

const healthBarSystem = defineSystem("healthBarSystem", (world) => {
  const damaged = cacheQuery(world, [changed(Health)]);

  return () => {
    // Entities where Health was modified (added OR value changed)
    queryEntities(world, damaged, (entity) => {
      updateHealthBar(entity);
    });
  };
});

const minimapSystem = defineSystem("minimapSystem", (world) => {
  // Combine change detection with regular filters
  const movedPlayers = cacheQuery(world, [Player, changed(Position), not(Dead)]);

  return () => {
    queryEntities(world, movedPlayers, (e) => {
      updatePlayerOnMinimap(e);
    });
  };
});
```

Each system tracks changes independently -- if two systems query `added(Position)`, both see the same newly added entities.

#### Detecting Removal

Use `removed()` to detect when a component is removed from an entity. Unlike `added()` and `changed()`, removal detection uses the event system:

```typescript
// Iterate removal events (not a query filter)
readEvents(world, removed(Health), (event) => {
  playDeathAnimation(event.entity);
});
```

#### Under the Hood

Removal detection works differently because when an entity loses a component, it moves to a new archetype -- the old archetype's data becomes inaccessible. Rather than maintain slow global storage for deleted components, `removed()` emits events before the transition occurs. This keeps the fast archetype-local design while enabling removal detection.

### Observers

An **Observer** is a callback that fires in response to ECS lifecycle events. Unlike the event system (for inter-system communication), observers hook directly into internal ECS operations.

```typescript
import {
  registerObserverCallback,
  unregisterObserverCallback,
} from "iris-ecs";

// React to entity creation
registerObserverCallback(world, "entityCreated", (entity) => {
  console.log(`Entity ${entity} created`);
});

// React to component changes
registerObserverCallback(world, "componentAdded", (compId, entityId) => {
  console.log(`Component ${compId} added to entity ${entityId}`);
});

// Unregister when done
const handler = (entity) => { /* ... */ };
registerObserverCallback(world, "entityDestroyed", handler);
unregisterObserverCallback(world, "entityDestroyed", handler);
```

#### Available Events

| Event | Payload | When |
|-------|---------|------|
| `entityCreated` | `(entity)` | After `createEntity()` |
| `entityDestroyed` | `(entityId)` | Before entity cleanup |
| `componentAdded` | `(componentId, entityId)` | After component added |
| `componentRemoved` | `(componentId, entityId)` | Before component removed |
| `componentChanged` | `(componentId, entityId)` | After `setComponentValue()` |
| `archetypeCreated` | `(archetype)` | After archetype created |
| `archetypeDestroyed` | `(archetype)` | Before archetype cleanup |
| `worldReset` | `(world)` | After `resetWorld()` |

Use observers for debugging, logging, editor integration, or triggering side effects that must happen immediately when the ECS state changes.

💡 **Tip:** For game logic that reacts to changes, prefer change detection queries or the event system. Observers are best for low-level integrations.

## Acknowledgments

iris-ecs builds on ideas from these excellent ECS libraries:

- [Flecs](https://github.com/SanderMertens/flecs) - Sander Mertens' [Medium articles](https://ajmmertens.medium.com/) on archetype storage and the "everything is an entity" model shaped core architecture. Entity naming, ID encoding, and resource patterns follow Flecs footsteps.
- [Bevy](https://github.com/bevyengine/bevy) - The change detection API (`added`, `changed`), system scheduling with ordering constraints, and event system design draw heavily from Bevy's approach.
- [Koota](https://github.com/pmndrs/koota) - My introduction to ECS. Demonstrated how far TypeScript ECS ergonomics can go. The actions API pattern comes directly from Koota.
- [Jecs](https://github.com/Ukendio/jecs) - The [thesis paper](https://github.com/Ukendio/jecs/blob/b7a5785dbbeefa4cb035673f4eec4f93440acc48/thesis/drafts/1/paper.pdf) on archetype internals, ID encoding strategies, and relation semantics informed the implementation.

## License

MIT
