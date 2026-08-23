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
  collectEntities,
  getComponentView,
  markComponentChanged,
  addSystem,
  runOnce,
  Type,
} from "iris-ecs";

// Define components -- vector fields store x,y interleaved in one TypedArray
const Position = defineComponent("Position", { schema: { value: Type.f32(2) } });
const Velocity = defineComponent("Velocity", { schema: { value: Type.f32(2) } });
const Player = defineComponent("Player");

// Create world and entities
const world = createWorld();

const player = createEntity(world, [
  [Position, { value: [0, 0] }],
  [Velocity, { value: [1, 0] }],
  Player,
]);

// Define a system
const movementSystem = defineSystem("movementSystem", (world) => {
  const entities = collectEntities(world, [Position, Velocity]);

  for (const e of entities) {
    const pos = getComponentView(world, e, Position, "value");
    const vel = getComponentView(world, e, Velocity, "value");

    pos[0] += vel[0];
    pos[1] += vel[1];
  }
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

Components, tags, and relations are also entities internally. `defineComponent()` creates a special entity that can be attached to other entities. This unified model means components can have components, enabling patterns like adding metadata to component types.

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
import { defineComponent, addComponent, hasComponent, removeComponent } from "iris-ecs";

const Player = defineComponent("Player");
const Enemy = defineComponent("Enemy");
const Poisoned = defineComponent("Poisoned");

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
  getComponent,
  setComponent,
  getComponentValue,
  setComponentValue,
  getComponentView,
  markComponentChanged,
} from "iris-ecs";

const Position = defineComponent("Position", { schema: { value: Type.f32(2) } });
const Health = defineComponent("Health", { schema: { current: Type.i32(), max: Type.i32() } });

addComponent(world, entity, [Position, { value: [0, 0] }]);
addComponent(world, entity, [Health, { current: 100, max: 100 }]);

// Read or replace the complete record
const health = getComponent(world, entity, Health);  // { current: 100, max: 100 }
setComponent(world, entity, Health, { current: 90, max: 100 });

// Read or write one scalar or vector field
const hp = getComponentValue(world, entity, Health, "current");  // 90
setComponentValue(world, entity, Health, "current", 80);

// Borrow a live view when copying a vector is unnecessary
const pos = getComponentView(world, entity, Position, "value");  // Float32Array [0, 0]
pos[0] = 10;
```

`getComponent()` returns an allocated record snapshot. Its vector fields are also copies, while reference fields retain their stored values. `setComponent()` replaces every field in the record. Use `getComponentValue()` and `setComponentValue()` when you only need one field, avoiding record allocations.

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
addComponent(world, entity, [Health, { current: 100, max: 100 }]);
addComponent(world, entity, [Health, { current: 50, max: 50 }]);  // ignored

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
  getComponentValue,
  setComponentValue,
  getComponentView,
  Type,
} from "iris-ecs";

const Position = defineComponent("Position", { schema: { value: Type.f32(2) } });
const Color = defineComponent("Color", { schema: { value: Type.u32(4) } });

const entity = createEntity(world);
addComponent(world, entity, [Position, { value: [10, 20] }]);
addComponent(world, entity, [Color, { value: [255, 128, 0, 255] }]);
```

The value functions copy vector fields as tuples:

```typescript
// Copy-based read -- returns a tuple (e.g., [number, number])
const pos = getComponentValue(world, entity, Position, "value");

// Copy-based write
setComponentValue(world, entity, Position, "value", [30, 40]);

// Zero-copy view -- returns a TypedArray subarray backed by the column buffer
const view = getComponentView(world, entity, Position, "value");
view[0] += 1.0; // direct mutation, no copy
markComponentChanged(world, entity, Position);
```

The view shares the underlying buffer, so mutations are immediate and bypass automatic change tracking. Call `markComponentChanged()` after writing. Structural changes can invalidate views; use them locally and do not cache them.

Components can mix scalar and vector fields:

```typescript
const Particle = defineComponent("Particle", {
  schema: {
    position: Type.f32(3),
    mass: Type.f32(),
  },
});

addComponent(world, entity, [Particle, { position: [0, 0, 0], mass: 1.0 }]);

const mass = getComponentValue(world, entity, Particle, "mass");          // number
const pos = getComponentValue(world, entity, Particle, "position");       // [number, number, number]
```

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

const Time = defineComponent("Time", { schema: { delta: Type.f32(), elapsed: Type.f32() } });

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
const resources = collectEntities(world, [Time]);
// resources[0] === Time (the component ID itself)
```

Use resources for frame timing, configuration, asset registry, input state, physics settings, or any global data that systems need but doesn't belong to a specific entity.

Resources with vector fields use dedicated resource accessors:

```typescript
import {
  defineComponent,
  addResource,
  getResourceVectorValue,
  setResourceVectorValue,
  getResourceVectorView,
  Type,
} from "iris-ecs";

const Gravity = defineComponent("Gravity", { schema: { value: Type.f64(3) } });
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
  collectEntities,
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
const children = collectEntities(world, [pair(ChildOf, scene)]);
// children[0] === player

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

addComponent(world, turret, [pair(Targets, enemy), { priority: 10 }]);

const p = pair(Targets, enemy);
const priority = getComponentValue(world, turret, p, "priority");
```

Relation data uses the same record, value, and view accessors as components.

```typescript
const Offset = defineRelation("Offset", {
  schema: { value: Type.f32(2) },
});

const p = pair(Offset, target);
addComponent(world, entity, [p, { value: [10, 20] }]);
const offset = getComponentView(world, entity, p, "value");
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

A **Query** fetches entities that match a set of component constraints. Use `collectEntities()` to collect matches for traversal or `queryFirstEntity()` when only one match is needed.

```typescript
import { collectEntities, queryFirstEntity, not } from "iris-ecs";

// Collect and process all entities with Position and Velocity
const entities = collectEntities(world, [Position, Velocity]);

for (const entity of entities) {
  const pos = getComponentView(world, entity, Position, "value")!;
  // ...
}

// Get a singleton (first match or undefined)
const player = queryFirstEntity(world, [Player, not(Dead)]);
```

#### Exclusion Filters

Use `not()` to exclude entities that have a component:

```typescript
// All entities with Position but WITHOUT the Dead tag
const living = collectEntities(world, [Position, not(Dead)]);

// Multiple exclusions
const moving = collectEntities(world, [Position, Velocity, not(Frozen), not(Disabled)]);
```

#### Or Filters

Use `or()` to match entities that have at least one of the given components. Each matching entity is visited exactly once, even when it has several of the alternatives:

```typescript
import { collectEntities, or, not } from "iris-ecs";

// All entities with Position AND (Velocity OR Acceleration)
const moving = collectEntities(world, [Position, or(Velocity, Acceleration)]);

// Combines freely with other modifiers
const active = collectEntities(world, [or(Velocity, Acceleration), not(Frozen)]);
```

Alternatives must be plain component, tag, or pair IDs -- modifiers are not allowed inside `or()`. Or'd components are match-only: they are not guaranteed present on results, so read them conditionally (e.g. via `hasComponent`).

#### Filters and Archetypes (Under the Hood)

Queries match archetypes where all required components are present and no excluded components exist. Matched archetypes are cached and auto-update when archetypes are created or destroyed. An `or()` term expands into one cached filter per alternative, built so that no archetype matches more than one -- results stay deduplicated without any extra bookkeeping at iteration time.

### Systems

A **System** is a named tick that operates on the world. Systems query entities, read and write components, emit events, and implement game logic.

Use `defineSystem()` to create every system. Its tick receives the world each time the scheduler runs it.

Systems are registered with `addSystem()` and executed automatically when the world runs.

```typescript
import {
  defineSystem,
  addSystem,
  run,
  stop,
  collectEntities,
  getComponentView,
  getResourceValue,
  markComponentChanged,
} from "iris-ecs";

const movementSystem = defineSystem("movementSystem", (world) => {
  const dt = getResourceValue(world, Time, "delta") ?? 0;

  const entities = collectEntities(world, [Position, Velocity]);

  for (const e of entities) {
    const pos = getComponentView(world, e, Position, "value");
    const vel = getComponentView(world, e, Velocity, "value");

    pos[0] += vel[0] * dt;
    pos[1] += vel[1] * dt;

    markComponentChanged(world, e, Position);
  }
});

addSystem(world, movementSystem);
run(world);

// ... later
await stop(world);
```

#### Ordering Constraints

Control execution order with `before` and `after` options:

```typescript
const inputSystem = defineSystem("inputSystem", (world) => {
  /* read input */
});
const physicsSystem = defineSystem("physicsSystem", (world) => {
  /* simulate physics */
});
const renderSystem = defineSystem("renderSystem", (world) => {
  /* draw frame */
});

addSystem(world, inputSystem);
addSystem(world, physicsSystem, { after: "inputSystem" });
addSystem(world, renderSystem, { after: "physicsSystem" });
// Executes: inputSystem -> physicsSystem -> renderSystem
```

Without constraints, systems run in registration order. Use arrays for multiple constraints: `{ after: ["inputSystem", "audioSystem"] }`.

A system can be registered multiple times with different names via the `name` option: `addSystem(world, movementSystem, { name: "lateMovement" })`.

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

#### Conditions

**Conditions** skip systems when shared application state says they should not run. Define a reusable condition with `defineCondition()` and attach it to a system or system set:

```typescript
import { addSystem, addSystemSet, defineCondition, getResourceValue } from "iris-ecs";

const gameIsPlaying = defineCondition("gameIsPlaying", (world) => {
  return getResourceValue(world, GameState, "playing") === true;
});

addSystemSet(world, GameplaySystems, { condition: gameIsPlaying });
addSystem(world, updatePlayer, { set: GameplaySystems });
addSystem(world, updateEnemies, { set: GameplaySystems });
addSystem(world, updateAudio, { condition: gameIsPlaying });
```

A condition definition is checked at most once per schedule run. Its result is shared by every system and set using that same definition in the schedule; create separate definitions when checks need independent identity. Checks run outside system context, so event reads and change-detection queries see nothing.

Use `once()` for the first evaluation or `every(ticks)` for evaluation intervals:

```typescript
import { every, once } from "iris-ecs";
 
addSystem(world, initializeRenderer, { condition: once() });
addSystem(world, updateAI, { condition: every(10) });
```

#### Schedules

Systems are grouped into **schedules** -- named execution phases. The default pipeline runs these schedules every frame:

```
First -> PreUpdate -> Update -> PostUpdate -> Last
```

`Update` is the default schedule. Assign systems to other phases based on when they should run:

```typescript
import { addSystem, First, PreUpdate, PostUpdate, Last, run, stop, suspend } from "iris-ecs";

addSystem(world, inputSystem, { schedule: First });
addSystem(world, physicsSystem, { schedule: PreUpdate });
addSystem(world, movementSystem); // defaults to Update
addSystem(world, collisionSystem, { schedule: PostUpdate });
addSystem(world, renderSystem, { schedule: Last });
 
run(world);

// Suspend and resume the animation frame loop without running lifecycle schedules
await suspend(world);
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

`run(world)` starts or resumes a `requestAnimationFrame` loop. Each frame runs all pipeline schedules then flushes events. `suspend(world)` stops scheduling frames after the active frame completes without running Shutdown. `stop(world)` stops the loop and runs Shutdown. Calling `stop()` then `run()` again re-triggers Startup and Shutdown for each cycle.

For manual frame stepping (tests, server-side), use `runOnce()`:

```typescript
import { runOnce } from "iris-ecs";

await runOnce(world); // one frame
```

#### Async Systems

Systems can be async. Both `run()` and `runOnce()` handle sync and async systems transparently:

```typescript
const loadAssetsSystem = defineSystem("loadAssetsSystem", async (world) => {
  const textures = await fetch("/assets/textures.json");
  // ...
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

const waveSystem = defineSystem("waveSystem", (world) => {
  const spawn = spawnActions(world);
  spawn.enemy(Math.random() * 100, 0);
});
```

Actions are initialized lazily and cached per world -- calling `spawnActions(world)` multiple times returns the same object.

💡 **Tip:** Use actions to organize spawn helpers, update functions, or any reusable world operations.

### Events

An **Event** is an ephemeral message for communication between systems. Unlike components (persistent data on entities), events are fire-and-forget: emit once, consume once per system, then gone.

```typescript
import { defineEvent, emitEvent, readEvents, Type } from "iris-ecs";

// Tag event (no data)
const GameStarted = defineEvent("GameStarted");

// Data event
const DamageDealt = defineEvent("DamageDealt", {
  schema: {
    target: Type.u32(),
    amount: Type.f32(),
  },
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

**Change detection** tracks when components are added, modified, or removed, letting systems process only what changed since they last looked.

```typescript
import {
  defineSystem,
  collectEntities,
  readEvents,
  added,
  changed,
  removed,
  not,
} from "iris-ecs";

const physicsSetupSystem = defineSystem("physicsSetupSystem", (world) => {
  // Entities where Position was added since this system last read this query
  const entities = collectEntities(world, [added(Position)]);

  for (const entity of entities) {
    initializePhysicsBody(entity);
  }
});

const healthBarSystem = defineSystem("healthBarSystem", (world) => {
  // Entities where Health was modified (added OR value changed)
  const entities = collectEntities(world, [changed(Health)]);

  for (const entity of entities) {
    updateHealthBar(entity);
  }
});

const minimapSystem = defineSystem("minimapSystem", (world) => {
  // Combine change detection with regular filters
  const entities = collectEntities(world, [Player, changed(Position), not(Dead)]);

  for (const e of entities) {
    updatePlayerOnMinimap(e);
  }
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

Removal detection works differently because when an entity loses a component, it moves to a new archetype -- the old archetype's data becomes inaccessible. Rather than maintain slow global storage for deleted components, `removed()` emits an event carrying just the entity as the transition happens. This keeps the fast archetype-local des ign while enabling removal detection.

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

During observer dispatch, a callback may unregister itself. It must not register or unregister other callbacks for the event currently being dispatched; doing so can lead to an undefined behavior.

#### Available Events

| Event | Payload | When |
|-------|---------|------|
| `entityCreated` | `(entity)` | After the entity is allocated, before initial components attach |
| `entityDestroying` | `(entityId)` | Before cleanup -- entity is alive and its component data is still readable |
| `entityDestroyed` | `(entityId)` | After removal -- the entity is gone, so reads through the handle throw |
| `componentAdded` | `(componentId, entityId)` | After component added |
| `componentRemoved` | `(componentId, entityId)` | After removal -- the component is gone, so reads for it return `undefined` |
| `componentChanged` | `(componentId, entityId)` | After a value write, including the initial data write of `addComponent()` (which precedes `componentAdded`) |
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
