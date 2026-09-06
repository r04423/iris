<h1 align="center">Iris</h1>

<p align="center">An Entity Component System for TypeScript.</p>

<p align="center">
  <a href="https://github.com/r04423/iris/actions/workflows/ci.yml"><img src="https://github.com/r04423/iris/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/iris-ecs"><img src="https://img.shields.io/npm/v/iris-ecs" alt="npm version"></a>
  <a href="https://github.com/r04423/iris/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
</p>

Entity Component System (ECS) is an architecture that organizes application state
into entities and components, with systems providing the logic that operates on
that data. Entities identify things in the application, components hold their
data, and systems process entities with the components they need.

Iris lets you build ECS applications in TypeScript. It supports:

- **Components and resources:** typed scalar, vector, and reference fields, tags,
  and shared world-level state.
- **Queries:** component filters and change detection for added, changed, or
  removed data.
- **Systems and schedules:** execution phases, ordering constraints, system sets,
  conditions, and async functions.
- **Events:** typed messages that each system can consume independently.
- **Relations:** connections between entities, such as parent-child relationships
  and ownership.
- **Archetype storage:** entities grouped by their components, with TypedArrays
  for numeric data and no runtime dependencies.

## Install

```bash
npm install iris-ecs
```

## Example

Below is a quick example of building a simple particle simulation that reacts to
external events. The sections build on each other, from defining the data to
running the application.

### Defining data

Components describe what an entity stores. Here, position and velocity each hold a
2D vector. The `Particle` tag identifies particles without storing additional data,
and an event describes where a new particle should appear.

```typescript
import { defineComponent, defineEvent, Type } from "iris-ecs";

const Particle = defineComponent("Particle");

const Position = defineComponent("Position", {
  schema: {
    current: Type.f32(2),
  },
});

const Velocity = defineComponent("Velocity", {
  schema: {
    current: Type.f32(2),
  },
});

const SpawnParticle = defineEvent("SpawnParticle", {
  schema: {
    position: Type.f32(2),
    velocity: Type.f32(2),
  },
});
```

### Reacting to events

Systems receive the world when they run. This one reads spawn requests and creates
entities with their initial components.

```typescript
import { createEntity, defineSystem, readEvents } from "iris-ecs";

const spawnParticles = defineSystem("spawnParticles", (world) => {
  readEvents(world, SpawnParticle, (event) => {
    createEntity(world, [
      Particle,
      [Position, { current: event.position }],
      [Velocity, { current: event.velocity }],
    ]);
  });
});
```

### Updating state

Collect entities with both components, read their values, and write the next
position. Velocity is measured in units per frame in this example. Writing a
position also marks it as changed for change-detection queries.

```typescript
import { collectEntities, getComponentValue, setComponentValue } from "iris-ecs";

const moveParticles = defineSystem("moveParticles", (world) => {
  for (const entity of collectEntities(world, [Position, Velocity])) {
    const [x, y] = getComponentValue(world, entity, Position, "current");
    const [vx, vy] = getComponentValue(world, entity, Velocity, "current");

    setComponentValue(world, entity, Position, "current", [
      x + vx,
      y + vy,
    ]);
  }
});
```

### Scheduling systems

Create a world and assign each system to a phase. `PreUpdate` runs before `Update`,
so newly spawned particles move in the same frame.

```typescript
import { addSystem, createWorld, PreUpdate, Update } from "iris-ecs";

const world = createWorld();

addSystem(world, spawnParticles, { schedule: PreUpdate });
addSystem(world, moveParticles, { schedule: Update });
```

### Running the application

Start the application loop, then emit a spawn request. The spawn system
handles the request once, and the movement system updates the particle each frame.
You can emit more requests from application code, such as an input handler.

```typescript
import { emitEvent, run } from "iris-ecs";

run(world);

emitEvent(world, SpawnParticle, {
  position: [0, 0],
  velocity: [1, 0.5],
});
```

## Explore more

- [React bindings](https://github.com/r04423/iris/tree/main/packages/react): optional hooks for connecting an Iris world to React.
- [Space Shooter](https://github.com/r04423/iris/tree/main/apps/space-shooter): a complete game built with Iris. [Play it](https://r04423.github.io/iris/space-shooter/).
- [Benchmarks](https://github.com/r04423/iris/tree/main/apps/benchmark): performance suites, methodology, and results.

## License

[MIT](https://github.com/r04423/iris/blob/main/LICENSE)
