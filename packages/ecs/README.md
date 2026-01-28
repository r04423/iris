# iris-ecs

High-performance, TypeScript-idiomatic Entity Component System.

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

## Quick Start

```typescript
import {
  createWorld,
  createEntity,
  defineComponent,
  defineTag,
  addComponent,
  getComponentValue,
  setComponentValue,
  fetchEntities,
  addSystem,
  buildSchedule,
  executeSchedule,
  Type,
} from "iris-ecs";

// Define components
const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });
const Velocity = defineComponent("Velocity", { x: Type.f32(), y: Type.f32() });
const Player = defineTag("Player");

// Create world and entities
const world = createWorld();

const player = createEntity(world);
addComponent(world, player, Position, { x: 0, y: 0 });
addComponent(world, player, Velocity, { x: 1, y: 0 });
addComponent(world, player, Player);

// Define a system
function movementSystem(world) {
  for (const entity of fetchEntities(world, Position, Velocity)) {
    const vx = getComponentValue(world, entity, Velocity, "x");
    const vy = getComponentValue(world, entity, Velocity, "y");
    const px = getComponentValue(world, entity, Position, "x");
    const py = getComponentValue(world, entity, Position, "y");

    setComponentValue(world, entity, Position, "x", px + vx);
    setComponentValue(world, entity, Position, "y", py + vy);
  }
}

// Register and run systems
addSystem(world, movementSystem);
buildSchedule(world);
executeSchedule(world);

// Position is now { x: 1, y: 0 }
```

## Core Concepts

### Entities

An **Entity** is a unique identifier representing a thing in your world. Entities have no data of their own -- they're containers for components.

```typescript
import { createWorld, createEntity, destroyEntity, isEntityAlive, resetWorld } from "iris-ecs";

const world = createWorld();

const player = createEntity(world);
const enemy = createEntity(world);

destroyEntity(world, enemy);
isEntityAlive(world, enemy); // false
isEntityAlive(world, player); // true

// Clear all entities and state, keeping component/tag definitions
resetWorld(world);
```

Create entities with `createEntity()`, destroy them with `destroyEntity()`. Use `isEntityAlive()` to check if an entity reference is still valid. Call `resetWorld()` to clear all entities and state while preserving definitions -- useful for level reloads or testing.

⚠ **Entity IDs are recycled.** After destroying an entity, its ID may be reused for a new entity. Never store entity IDs long-term without checking `isEntityAlive()` first -- your old reference might now point to a different entity.

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

// Validate components during lookup
lookupByName(world, "player-1", Position, Health);  // returns entity only if it has both

removeName(world, player);
lookupByName(world, "player-1");     // undefined
```

Names are automatically cleaned up when entities are destroyed. Use names for integrations, save / load systems, or any scenario where you need to reference entities by string identifier.

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
import { defineComponent, Type, addComponent, getComponentValue, setComponentValue } from "iris-ecs";

const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });
const Health = defineComponent("Health", { current: Type.i32(), max: Type.i32() });

addComponent(world, entity, Position, { x: 0, y: 0 });
addComponent(world, entity, Health, { current: 100, max: 100 });

const x = getComponentValue(world, entity, Position, "x");  // 0
setComponentValue(world, entity, Position, "x", 10);
```

#### Schema Types

The `Type` namespace provides storage-optimized types:

| Type | Storage | Use case |
|------|---------|----------|
| `Type.f32()` | Float32Array | Positions, velocities, normalized values |
| `Type.f64()` | Float64Array | High-precision calculations |
| `Type.i8()` | Int8Array | Small signed integers (-128 to 127) |
| `Type.i16()` | Int16Array | Medium signed integers |
| `Type.i32()` | Int32Array | Entity counts, scores, health |
| `Type.u32()` | Uint32Array | Unsigned integers, bit flags |
| `Type.bool()` | Array | Boolean flags |
| `Type.string()` | Array | Text data |
| `Type.object<T>()` | Array | Complex nested objects |

Numeric types use TypedArrays for cache-friendly memory layout. Use the smallest type that fits your data.

#### Adding Components is Idempotent

Adding a component that already exists does nothing -- the existing data is preserved.

```typescript
addComponent(world, entity, Position, { x: 0, y: 0 });
addComponent(world, entity, Position, { x: 99, y: 99 });  // ignored

getComponentValue(world, entity, Position, "x");  // still 0
```

Use `hasComponent()` to check first if you need conditional addition, or `setComponentValue()` to update existing data.

### Resources

A **Resource** is a global singleton -- world-level data that isn't attached to any specific entity. Define resources using regular components and store them with `addResource()`.

```typescript
import { defineComponent, addResource, getResourceValue, setResourceValue, hasResource, removeResource, Type } from "iris-ecs";

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
for (const entity of fetchEntities(world, Time)) {
  // entity === Time (the component ID itself)
}
```

Use resources for frame timing, configuration, asset registry, input state, physics settings, or any global data that systems need but doesn't belong to a specific entity.

### Relations

A **Relation** describes a directed connection between two entities. Combine a relation with a target using `pair()` to create a pair -- pairs are added to entities like components.

```typescript
import { defineRelation, pair, addComponent, fetchEntities, getRelationTargets, Wildcard } from "iris-ecs";

const ChildOf = defineRelation("ChildOf");

const scene = createEntity(world);
const player = createEntity(world);
const weapon = createEntity(world);

addComponent(world, player, pair(ChildOf, scene));
addComponent(world, weapon, pair(ChildOf, player));

// Query children of a specific parent
for (const child of fetchEntities(world, pair(ChildOf, scene))) {
  // child === player
}

// Get all targets for a relation on an entity
const parents = getRelationTargets(world, weapon, ChildOf); // [player]
```

Use relations for hierarchies (parent/child), ownership, targeting, dependencies, or any directed graph structure.

#### Wildcard Queries

Use `Wildcard` to match any relation or target:

```typescript
// All entities with ANY ChildOf relation (any target)
const allChildren = [...fetchEntities(world, pair(ChildOf, Wildcard))];

// All entities targeting a specific entity (any relation)
const relatedToPlayer = [...fetchEntities(world, pair(Wildcard, player))];
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
const Targets = defineRelation("Targets", { schema: { priority: Type.i8() } });

addComponent(world, turret, pair(Targets, enemy), { priority: 10 });
const priority = getComponentValue(world, turret, pair(Targets, enemy), "priority");
```

### Archetypes (Under the Hood)

An **Archetype** groups entities that share the same component set. All entities with `Position` and `Velocity` live in one archetype; entities with `Position`, `Velocity`, and `Health` live in another.

```
Archetype [Position, Velocity]          Archetype [Position, Velocity, Health]
┌─────────┬─────────┬─────────┐         ┌─────────┬─────────┬─────────┬─────────┐
│ Entity  │ Pos.x/y │ Vel.x/y │         │ Entity  │ Pos.x/y │ Vel.x/y │ Health  │
├─────────┼─────────┼─────────┤         ├─────────┼─────────┼─────────┼─────────┤
│ bullet1 │  10, 5  │  1, 0   │         │ player  │  0, 0   │  1, 0   │  100    │
│ bullet2 │  15, 8  │  1, 0   │         │ enemy   │  50, 20 │ -1, 0   │   50    │
└─────────┴─────────┴─────────┘         └─────────┴─────────┴─────────┴─────────┘
```

Within an archetype, component data is stored in **columns** (TypedArrays for numeric types). When a query iterates entities with `Position` and `Velocity`, it walks through archetypes that contain both components. This columnar layout keeps component values in contiguous TypedArrays rather than scattered across individual objects, reducing memory overhead and enabling efficient iteration.

Adding or removing a component moves an entity to a different archetype. This is more expensive than reading or writing component values, so prefer stable component sets for entities that update frequently.

You don't interact with archetypes directly -- the ECS handles them automatically. Understanding the model helps you design components that group well and avoid unnecessary archetype transitions.

### Queries

A **Query** fetches entities that match a set of component constraints. Use `fetchEntities()` to iterate all matches or `fetchFirstEntity()` for singletons.

```typescript
import { fetchEntities, fetchFirstEntity, not } from "iris-ecs";

// Iterate all entities with Position and Velocity
for (const entity of fetchEntities(world, Position, Velocity)) {
  const x = getComponentValue(world, entity, Position, "x");
  // ...
}

// Get a singleton (first match or undefined)
const player = fetchFirstEntity(world, Player, not(Dead));
```

Queries are cached internally -- the same component set returns the same cached query.

#### Exclusion Filters

Use `not()` to exclude entities that have a component:

```typescript
// All entities with Position but WITHOUT the Dead tag
for (const entity of fetchEntities(world, Position, not(Dead))) {
  // Only living entities
}

// Multiple exclusions
for (const entity of fetchEntities(world, Position, Velocity, not(Frozen), not(Disabled))) {
  // Entities that can move
}
```

#### Filters and Archetypes (Under the Hood)

Queries match archetypes where all required components are present and no excluded components exist. Matched archetypes are cached and auto-update when new archetypes are created.

### Systems

A **System** is a function that operates on the world. Systems query entities, read and write components, emit events, and implement game logic.

```typescript
import { addSystem, buildSchedule, executeSchedule, fetchEntities, getComponentValue, setComponentValue } from "iris-ecs";

function movementSystem(world) {
  for (const entity of fetchEntities(world, Position, Velocity)) {
    const px = getComponentValue(world, entity, Position, "x");
    const py = getComponentValue(world, entity, Position, "y");
    const vx = getComponentValue(world, entity, Velocity, "x");
    const vy = getComponentValue(world, entity, Velocity, "y");

    setComponentValue(world, entity, Position, "x", px + vx);
    setComponentValue(world, entity, Position, "y", py + vy);
  }
}

addSystem(world, movementSystem);
buildSchedule(world);

// Game loop
while (running) {
  executeSchedule(world);
}
```

Systems are registered with `addSystem()`, ordered by `buildSchedule()`, and run with `executeSchedule()`. The system function's name becomes its identifier.

#### Ordering Constraints

Control execution order with `before` and `after` options:

```typescript
function inputSystem(world) { /* read input */ }
function physicsSystem(world) { /* simulate physics */ }
function renderSystem(world) { /* draw frame */ }

addSystem(world, inputSystem);
addSystem(world, physicsSystem, { after: "inputSystem" });
addSystem(world, renderSystem, { after: "physicsSystem" });

buildSchedule(world);
// Executes: inputSystem -> physicsSystem -> renderSystem
```

Without constraints, systems run in registration order. Use arrays for multiple constraints: `{ after: ["inputSystem", "audioSystem"] }`.

#### Schedules

Systems are grouped into **schedules**. The default schedule is `"runtime"`, but you can create others for initialization, cleanup, or custom phases:

```typescript
addSystem(world, loadAssetsSystem, { schedule: "startup" });
addSystem(world, saveGameSystem, { schedule: "shutdown" });
addSystem(world, physicsSystem); // defaults to "runtime"

buildSchedule(world, "startup");
buildSchedule(world, "runtime");
buildSchedule(world, "shutdown");

executeSchedule(world, "startup"); // Run once at start
while (running) {
  executeSchedule(world);          // "runtime" is default
}
executeSchedule(world, "shutdown"); // Run once at end
```

#### Async Systems

For systems that need to `await` (loading assets, network calls), use `executeScheduleAsync()`:

```typescript
async function loadAssetsSystem(world) {
  const textures = await fetch("/assets/textures.json");
  // ...
}

addSystem(world, loadAssetsSystem, { schedule: "startup" });
buildSchedule(world, "startup");

await executeScheduleAsync(world, "startup");
```

⚠ `executeSchedule()` throws if any system returns a Promise. Use `executeScheduleAsync()` for schedules with async systems.

### Actions

**Actions** bundle reusable operations with a world captured in closure. Define actions once, then call them without repeatedly passing the world.

```typescript
import { defineActions, createEntity, addComponent } from "iris-ecs";

const spawnActions = defineActions((world) => ({
  player(x: number, y: number) {
    const entity = createEntity(world);
    addComponent(world, entity, Position, { x, y });
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

// In a system or anywhere with world access
const spawn = spawnActions(world);
const player = spawn.player(0, 0);
const enemy = spawn.enemy(100, 50);
```

Actions are initialized lazily and cached per world -- calling `spawnActions(world)` multiple times returns the same object.

Use actions to organize spawn helpers, update functions, or any reusable world operations.

### Events

An **Event** is an ephemeral message for communication between systems. Unlike components (persistent data on entities), events are fire-and-forget: emit once, consume once per system, then gone.

```typescript
import { defineEvent, emitEvent, fetchEvents, Type } from "iris-ecs";

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
  for (const event of fetchEvents(world, DamageDealt)) {
    applyDamage(event.target, event.amount);
  }
}
```

Use events when systems need to react to something that happened without polling entity state. Common patterns: collision notifications, input events, game state transitions.

#### Per-System Isolation

Each system independently tracks which events it has consumed. Multiple systems can read the same events:

```typescript
function uiSystem(world) {
  for (const e of fetchEvents(world, DamageDealt)) {
    showDamageNumber(e.target, e.amount);
  }
}

function audioSystem(world) {
  for (const e of fetchEvents(world, DamageDealt)) {
    playHitSound(e.amount);
  }
}

// Both systems see the same DamageDealt events
```

#### Event Utilities

```typescript
import { hasEvents, countEvents, fetchLastEvent, clearEvents } from "iris-ecs";

// Check without consuming
if (hasEvents(world, DamageDealt)) {
  const count = countEvents(world, DamageDealt);
}

// Get only the most recent event (marks all as read)
const lastInput = fetchLastEvent(world, InputChanged);

// Skip events without processing
if (isPaused) {
  clearEvents(world, DamageDealt);
  return;
}
```

#### Event Lifetime

Events persist for a short window (2 ticks) to ensure all systems can read them regardless of execution order, then expire automatically. Calling `fetchEvents()` marks events as read for that system -- a second call in the same system sees nothing new.

⚠ **Events are not entities.** Unlike components and tags, events exist outside the entity-component model. You cannot query for events or attach them to entities.

### Change Detection

**Change detection** tracks when components are added, modified, or removed, letting systems process only what changed since their last run.

```typescript
import { fetchEntities, added, changed, removed, fetchEvents } from "iris-ecs";

// Entities where Position was added this tick
for (const entity of fetchEntities(world, added(Position))) {
  initializePhysicsBody(entity);
}

// Entities where Health was modified (added OR value changed)
for (const entity of fetchEntities(world, changed(Health))) {
  updateHealthBar(entity);
}

// Combine with regular filters
for (const entity of fetchEntities(world, Player, changed(Position), not(Dead))) {
  updatePlayerOnMinimap(entity);
}
```

Each system tracks changes independently -- if two systems query `added(Position)`, both see the same newly added entities.

#### Detecting Removal

Use `removed()` to detect when a component is removed from an entity. Unlike `added()` and `changed()`, removal detection uses the event system:

```typescript
// Iterate removal events (not a query filter)
for (const event of fetchEvents(world, removed(Health))) {
  playDeathAnimation(event.entity);
}
```

#### Under the Hood

Removal detection works differently because when an entity loses a component, it moves to a new archetype -- the old archetype's data becomes inaccessible. Rather than maintain slow global storage for deleted components, `removed()` emits events before the transition occurs. This keeps the fast archetype-local design while still enabling removal detection.

### Observers

An **Observer** is a callback that fires in response to ECS lifecycle events. Unlike the event system (for inter-system communication), observers hook directly into internal ECS operations.

```typescript
import { registerObserverCallback, unregisterObserverCallback } from "iris-ecs";

// React to entity creation
registerObserverCallback(world, "entityCreated", (entity) => {
  console.log(`Entity ${entity} created`);
});

// React to component changes
registerObserverCallback(world, "componentAdded", (componentId, entityId) => {
  console.log(`Component ${componentId} added to entity ${entityId}`);
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

Use observers for debugging, logging, editor integration, or triggering side effects that must happen immediately when the ECS state changes. For game logic that reacts to changes, prefer change detection queries or the event system.

## Acknowledgments

iris-ecs builds on ideas from these excellent ECS libraries:

- [Flecs](https://github.com/SanderMertens/flecs) - Sander Mertens' [Medium articles](https://ajmmertens.medium.com/) on archetype storage and the "everything is an entity" model shaped core architecture. Entity naming, ID encoding, and resource patterns follow Flecs footsteps.
- [Bevy](https://github.com/bevyengine/bevy) - The change detection API (`added`, `changed`), system scheduling with ordering constraints, and event system design draw heavily from Bevy's approach.
- [Koota](https://github.com/pmndrs/koota) - My introduction to ECS. Demonstrated how far TypeScript ECS ergonomics can go. The actions API pattern comes directly from Koota.
- [Jecs](https://github.com/Ukendio/jecs) - The [thesis paper](https://github.com/Ukendio/jecs/blob/b7a5785dbbeefa4cb035673f4eec4f93440acc48/thesis/drafts/1/paper.pdf) on archetype internals, ID encoding strategies, and relation semantics informed the implementation.

## License

MIT
