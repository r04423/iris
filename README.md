<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/r04423/iris/main/assets/branding/iris-wordmark-dark.svg">
    <img src="https://raw.githubusercontent.com/r04423/iris/main/assets/branding/iris-wordmark-light.svg" alt="Iris" width="320" height="144">
  </picture>
</h1>

<p align="center">An Entity Component System for TypeScript.</p>

<p align="center">
  <a href="https://github.com/r04423/iris/actions/workflows/ci.yml"><img src="https://github.com/r04423/iris/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/iris-ecs"><img src="https://img.shields.io/npm/v/iris-ecs" alt="npm version"></a>
  <a href="https://github.com/r04423/iris/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
</p>

## ECS

ECS stands for Entity Component System. It is a way of organizing a program
that keeps identity, data, and behavior apart, and builds things by composing
pieces of data rather than by inheriting from a class.

An **entity** is an ID for some thing in our world. A **component** is a piece
of data we attach to an entity. A **system** is a function that runs every frame
and works on all the entities that have the components it asks for.

A good mental model is an in-memory database. Entities are rows, components are
columns, and systems are the queries we run over the table.

Instead of asking "what type is this object?", we ask "what components does this
entity have?". A ship has a position, a velocity, and health. An asteroid has a
position and a velocity. A system that moves things asks for position and
velocity, so it moves both without knowing what they are. Components can be
added and removed while the game runs, so an entity can gain and lose abilities
over its lifetime.

This works well when we have many things with overlapping behavior. Games are
the classic case, and so are simulations, editors, and visualizations with a lot
of moving parts. It is a poor fit for a form heavy app or a handful of objects
with unique logic. Plain objects serve those better.

## Install

```bash
npm install iris-ecs
```

## A first program

The smallest useful program defines some components, creates an entity that has
them, and runs a system over it.

We start by defining two components. Each holds a single vector field:

```typescript
import { defineComponent, Type } from "iris-ecs";

const Position = defineComponent("Position", { schema: { value: Type.f32(2) } });
const Velocity = defineComponent("Velocity", { schema: { value: Type.f32(2) } });
```

Then we write a system that adds velocity to position for every entity that has
both:

```typescript
import { collectEntities, defineSystem, getComponentValue, setComponentValue } from "iris-ecs";

const moveEntities = defineSystem("moveEntities", (world) => {
  for (const entity of collectEntities(world, [Position, Velocity])) {
    const [x, y] = getComponentValue(world, entity, Position, "value");
    const [vx, vy] = getComponentValue(world, entity, Velocity, "value");

    setComponentValue(world, entity, Position, "value", [x + vx, y + vy]);
  }
});
```

Finally we create a world, put one entity in it, register the system, and run a
single frame:

```typescript
import { addSystem, createEntity, createWorld, runOnce } from "iris-ecs";

const world = createWorld();

createEntity(world, [
  [Position, { value: [0, 0] }],
  [Velocity, { value: [1, 2] }],
]);

addSystem(world, moveEntities);

await runOnce(world);
```

After that frame the entity is at `[1, 2]`. Nothing ran until we registered the
system and stepped the world. Every Iris program has this shape: data, systems
that work on it, and a world that runs them.

## Entities

An entity is just an ID, a plain number that Iris hands out, and it holds no
data or behavior of its own. The data lives in components, and the entity is
how we find them.

Each entity can have at most one of each component. Components can be added and
removed at any point in the entity's life.

### Creating entities

We create entities with `createEntity`. On its own it gives us an empty entity:

```typescript
import { createEntity } from "iris-ecs";

const entity = createEntity(world);
```

Usually we want components on it right away, so we pass a list of entries,
where a tag goes in on its own and a component with data goes in as a pair with
its starting values:

```typescript
import { createEntity, defineSystem } from "iris-ecs";

const spawnAsteroids = defineSystem("spawnAsteroids", (world) => {
  for (let i = 0; i < 10; i++) {
    createEntity(world, [
      Asteroid,
      [Position, { value: [Math.random() * 800, Math.random() * 600] }],
      [Velocity, { value: [Math.random() - 0.5, Math.random() - 0.5] }],
    ]);
  }
});
```

This creates ten asteroids, each with a random position and drift. `Asteroid`
is a tag and `Position` and `Velocity` carry data.

We deliberately wrote this as a system instead of loose code, because systems
are where our logic lives.

### Destroying entities

To remove an entity we call `destroyEntity`. It drops every component the
entity has and frees its ID:

```typescript
import { collectEntities, defineSystem, destroyEntity } from "iris-ecs";

const despawnDead = defineSystem("despawnDead", (world) => {
  for (const entity of collectEntities(world, [Dead])) {
    destroyEntity(world, entity);
  }
});
```

Here we destroy everything carrying the `Dead` tag. Another system decides who
dies, and this one only cleans up.

### Checking if an entity is alive

Imagine the player clicks an asteroid and a tractor beam holds it in place
until they click somewhere else. We remember the clicked asteroid in a
variable, but a few frames later a bullet may destroy it, and then our variable
holds a stale ID.

`isEntityAlive` tells us whether an ID still points at a living entity:

```typescript
import { defineSystem, isEntityAlive, setComponentValue } from "iris-ecs";
import type { Entity } from "iris-ecs";

let held: Entity | undefined;

canvas.addEventListener("click", (event) => {
  held = pickAsteroidAt(world, event.offsetX, event.offsetY);
});

const holdAsteroid = defineSystem("holdAsteroid", (world) => {
  if (held === undefined || !isEntityAlive(world, held)) {
    held = undefined;
    return;
  }

  setComponentValue(world, held, Velocity, "value", [0, 0]);
});
```

While the asteroid lives, the beam zeroes its velocity every frame. Once it is
gone we drop the stale ID and move on.

Iris reuses the numbers of destroyed entities, so a new entity can end up with
the same number as one that is gone. To keep the two apart, every entity ID
also carries a generation that changes each time the number is reused.
`isEntityAlive` compares generations to tell an old ID from a new one. Because
numbers get reused, **entity IDs should not be stored for long without checking
them**.

Sometimes a missing entity is a bug rather than a case to skip. For those we
use `assertEntity`, which throws:

```typescript
import { assertEntity, defineSystem, queryFirstEntity } from "iris-ecs";

const resetShip = defineSystem("resetShip", (world) => {
  const ship = queryFirstEntity(world, [Ship, Position, Velocity]);

  assertEntity(world, ship);

  setComponentValue(world, ship, Position, "value", [400, 300]);
  setComponentValue(world, ship, Velocity, "value", [0, 0]);
});
```

`assertEntity` also narrows away the `undefined`. Iris relies on type narrowing
in many other places as well.

### Naming entities

Some entities we want to find by name, e.g. the player ship, the camera, or the
root of a level, and for those we can give the entity a name with `setName`:

```typescript
import { createEntity, defineSystem, setName } from "iris-ecs";

const spawnShip = defineSystem("spawnShip", (world) => {
  const ship = createEntity(world, [
    Ship,
    [Position, { value: [400, 300] }],
    [Velocity, { value: [0, 0] }],
    [Health, { current: 100, max: 100 }],
  ]);

  setName(world, ship, "player");
});
```

Names are unique in a world, and when the entity is destroyed the name goes
with it.

To find a named entity we call `lookupByName`. Passing the components we expect
makes the lookup fail unless they are all present, and narrows the result to
them:

```typescript
import { assertEntity, defineSystem, lookupByName } from "iris-ecs";

const healPlayer = defineSystem("healPlayer", (world) => {
  const ship = lookupByName(world, "player", [Health]);

  assertEntity(world, ship);

  const max = getComponentValue(world, ship, Health, "max");

  setComponentValue(world, ship, Health, "current", max);
});
```

`getName` reads a name back and `removeName` drops it.

## Systems

Systems are where we change the state of our game. A system is a named function
that receives the world, and Iris calls it for us once per frame.

We define a system with `defineSystem`:

```typescript
import { collectEntities, defineSystem, destroyEntity } from "iris-ecs";

const expireLifetimes = defineSystem("expireLifetimes", (world) => {
  for (const entity of collectEntities(world, [Lifetime])) {
    const remaining = getComponentValue(world, entity, Lifetime, "remaining");

    if (remaining <= 0) {
      destroyEntity(world, entity);
    } else {
      setComponentValue(world, entity, Lifetime, "remaining", remaining - 1);
    }
  }
});
```

Defining a system does not run it. We register it with a world using
`addSystem`, and from then on it runs every frame:

```typescript
import { addSystem, runOnce } from "iris-ecs";

addSystem(world, expireLifetimes);

await runOnce(world);
```

`runOnce` runs a single frame. We use it to see a system do its work, and we
use it in tests.

The rule we follow is that logic goes in systems, and code outside a system
only creates the world, registers systems, and hands input in.

## Components

Components are the data we attach to our entities, e.g. the position of a
ship, its health, or the sprite we draw it with.

Iris stores each component field in its own array, and numeric fields use typed
arrays, so a thousand positions are a thousand floats in one `Float32Array`
rather than a thousand objects. Not every ECS works this way, but Iris does,
and it is what keeps iterating many entities cheap.

### Tags

A component with no data is a tag. It marks an entity as belonging to a group:

```typescript
import { defineComponent } from "iris-ecs";

const Ship = defineComponent("Ship");
const Asteroid = defineComponent("Asteroid");
const Bullet = defineComponent("Bullet");
const Hit = defineComponent("Hit");
const Dead = defineComponent("Dead");
const Explosion = defineComponent("Explosion");
```

Tags work like indexes in a database, in that they let us ask for "every
asteroid" or "everything that is dead" without storing anything per entity.

### Components with data

A component with data declares a schema. The schema names each field and gives
it a type:

```typescript
import { defineComponent, Type } from "iris-ecs";

const Position = defineComponent("Position", {
  schema: { value: Type.f32(2) },
});

const Velocity = defineComponent("Velocity", {
  schema: { value: Type.f32(2) },
});

const Health = defineComponent("Health", {
  schema: { current: Type.i32(), max: Type.i32() },
});

const Lifetime = defineComponent("Lifetime", {
  schema: { remaining: Type.f32() },
});

const Shield = defineComponent("Shield", {
  schema: { strength: Type.i32() },
});

const Sprite = defineComponent("Sprite", {
  schema: { texture: Type.ref<HTMLImageElement>(), tint: Type.u32(4) },
});
```

The `Type` namespace has a factory for each kind of field:

| Type | Stored in | Good for |
|------|-----------|----------|
| `Type.f32()` | Float32Array | Positions, velocities, most floats |
| `Type.f64()` | Float64Array | Floats that need full precision |
| `Type.i8()` | Int8Array | Small signed numbers |
| `Type.i16()` | Int16Array | Medium signed numbers |
| `Type.i32()` | Int32Array | Health, scores, counts |
| `Type.u32()` | Uint32Array | Unsigned numbers, flags, entity IDs |
| `Type.bool()` | Array | Flags |
| `Type.string()` | Array | Text |
| `Type.ref<T>()` | Array | Any object: textures, arrays, class instances |

Passing a size from 2 to 16 to a numeric factory makes a **vector field**.
`Type.f32(2)` stores an `[x, y]` pair as two consecutive floats, and we read and
write it as a tuple. `Sprite.tint` above is a four element `u32` vector for RGBA.

### Adding components

We attach a component to an existing entity with `addComponent`. For a tag that
is all we pass. For a component with data we also pass its values:

```typescript
import { addComponent, collectEntities, defineSystem } from "iris-ecs";

const markDead = defineSystem("markDead", (world) => {
  for (const entity of collectEntities(world, [Health])) {
    if (getComponentValue(world, entity, Health, "current") <= 0) {
      addComponent(world, entity, Dead);
    }
  }
});
```

This system decides who died. It reads health, adds the `Dead` tag, and leaves
the cleanup to `despawnDead`.

To add several components at once we use `addComponents`, which takes the same
entry list as `createEntity`:

```typescript
import { addComponents, defineSystem, queryFirstEntity } from "iris-ecs";

const shipTexture = new Image();
shipTexture.src = "/assets/ship.png";

const dressShip = defineSystem("dressShip", (world) => {
  const ship = queryFirstEntity(world, [Ship]);

  assertEntity(world, ship);

  addComponents(world, ship, [
    [Shield, { strength: 100 }],
    [Sprite, { texture: shipTexture, tint: [255, 255, 255, 255] }],
  ]);
});
```

**Adding a component that is already there does nothing.** The existing values
stay. To change values we write to them, which we cover below.

### Removing components

`removeComponent` takes a component off an entity. Once a shield is used up,
we remove it rather than leaving a zero strength shield around:

```typescript
import { collectEntities, defineSystem, removeComponent } from "iris-ecs";

const dropShields = defineSystem("dropShields", (world) => {
  for (const entity of collectEntities(world, [Shield])) {
    if (getComponentValue(world, entity, Shield, "strength") <= 0) {
      removeComponent(world, entity, Shield);
    }
  }
});
```

`removeComponents` does the same for a list.

Adding or removing a component costs more than writing a value, because Iris
has to move the entity's data. Doing it now and then is fine, but it is worth
avoiding in a loop that touches every entity every frame.

### Checking for a component

Not every entity has every component. Say a ship can pick up a shield, which
adds a `Shield` component that absorbs hits until it runs out. A system that
applies a hit has to ask whether the shield is there before it reads from it:

```typescript
import { collectEntities, defineSystem, hasComponent } from "iris-ecs";

const applyHits = defineSystem("applyHits", (world) => {
  for (const entity of collectEntities(world, [Hit, Health])) {
    removeComponent(world, entity, Hit);

    if (hasComponent(world, entity, Shield)) {
      const strength = getComponentValue(world, entity, Shield, "strength");
      setComponentValue(world, entity, Shield, "strength", strength - 10);
      
      continue;
    }

    const current = getComponentValue(world, entity, Health, "current");

    setComponentValue(world, entity, Health, "current", current - 10);
  }
});
```

`hasComponent` is a type guard, so after the check `getComponentValue` returns
`number` instead of `number | undefined`.

When the component ought to be there and its absence is a bug, we use
`assertComponent`:

```typescript
import { assertComponent, assertEntity, defineSystem, lookupByName } from "iris-ecs";

const healPlayerFully = defineSystem("healPlayerFully", (world) => {
  const ship = lookupByName(world, "player");

  assertEntity(world, ship);
  assertComponent(world, ship, Health);

  const max = getComponentValue(world, ship, Health, "max");

  setComponentValue(world, ship, Health, "current", max);
});
```

`assertComponents` does the same for a list. Entities that come out of a query
are already narrowed to the components the query asked for, so most systems do
not need either.

### Reading and writing data

There are three ways to reach the data in a component, and they trade
convenience for speed.

The first is the whole record. `getComponent` returns an object with every
field copied out, and `setComponent` replaces every field:

```typescript
import { collectEntities, defineSystem, getComponent, setComponent } from "iris-ecs";

const respawnShip = defineSystem("respawnShip", (world) => {
  for (const ship of collectEntities(world, [Ship, Dead, Health])) {
    const health = getComponent(world, ship, Health);

    setComponent(world, ship, Health, { current: health.max, max: health.max });
    removeComponent(world, ship, Dead);
  }
});
```

Records are the easiest to read and the most expensive, because every call
allocates an object, so we keep them out of tight loops.

The second is a single field. `getComponentValue` and `setComponentValue` work
on one field by name. A scalar field comes back as a number:

```typescript
import { collectEntities, defineSystem, getComponentValue, setComponentValue } from "iris-ecs";

const rechargeShields = defineSystem("rechargeShields", (world) => {
  for (const entity of collectEntities(world, [Shield])) {
    const strength = getComponentValue(world, entity, Shield, "strength");

    setComponentValue(world, entity, Shield, "strength", Math.min(strength + 1, 100));
  }
});
```

A vector field comes back as a tuple copy, and we write it back the same way:

```typescript
import { collectEntities, defineSystem, getComponentValue, setComponentValue } from "iris-ecs";

const wrapAround = defineSystem("wrapAround", (world) => {
  for (const entity of collectEntities(world, [Position])) {
    const [x, y] = getComponentValue(world, entity, Position, "value");

    setComponentValue(world, entity, Position, "value", [x % 800, y % 600]);
  }
});
```

We use these two most of the time, since they allocate nothing for scalars and
only a small tuple for vectors.

The third is a view. `getComponentView` hands us the slice of the underlying
typed array where a vector field lives, and we write straight into it:

```typescript
import { collectEntities, defineSystem, getComponentView, markComponentChanged } from "iris-ecs";

const moveEntities = defineSystem("moveEntities", (world) => {
  for (const entity of collectEntities(world, [Position, Velocity])) {
    const position = getComponentView(world, entity, Position, "value");
    const velocity = getComponentView(world, entity, Velocity, "value");

    position[0] += velocity[0];
    position[1] += velocity[1];

    markComponentChanged(world, entity, Position);
  }
});
```

Nothing is copied, so this is the fastest way to update many entities, but it
also means Iris did not see the write. We tell it with `markComponentChanged`,
which is what value writes do for us automatically, and change detection
depends on this.

**A view is only valid until the next structural change**, because adding or
removing a component can move the entity's data. We take a view, use it inside
the loop, and let it go.

## Resources

Resources hold data that belongs to the world rather than to any one entity,
e.g. frame timing, the score, or whether the game is paused, and there is
exactly one of each per world.

We define a resource the same way we define a component:

```typescript
import { defineComponent, Type } from "iris-ecs";

const Time = defineComponent("Time", {
  schema: { delta: Type.f32(), elapsed: Type.f32() },
});

const Score = defineComponent("Score", {
  schema: { value: Type.i32() },
});

const GameState = defineComponent("GameState", {
  schema: { paused: Type.bool() },
});
```

What makes it a resource is how we store it. `addResource` puts one copy in the
world with no entity involved:

```typescript
import { addResource, addSystem, defineSystem, Startup } from "iris-ecs";

const initResources = defineSystem("initResources", (world) => {
  addResource(world, Time, { delta: 0, elapsed: 0 });
  addResource(world, Score, { value: 0 });
  addResource(world, GameState, { paused: false });
});

addSystem(world, initResources, { schedule: Startup });
```

Registering it in the `Startup` schedule makes it run once, before the first
frame.

The accessors mirror the component ones. `getResourceValue` and
`setResourceValue` work on a field. `getResource` and `setResource` work on the
whole record. `getResourceView` borrows a vector field, and
`markResourceChanged` tells Iris we wrote through it.

A system that cannot work without a resource calls `assertResource` first. It
throws if the resource is missing and narrows it for the reads that follow:

```typescript
import { addSystem, assertResource, defineSystem, First, getResourceValue, setResourceValue } from "iris-ecs";

const tickTime = defineSystem("tickTime", (world) => {
  assertResource(world, Time);

  const now = performance.now() / 1000;
  const elapsed = getResourceValue(world, Time, "elapsed");

  setResourceValue(world, Time, "delta", now - elapsed);
  setResourceValue(world, Time, "elapsed", now);
});

addSystem(world, tickTime, { schedule: First });
```

The clock **does not advance on its own**, so this system runs at the start of
every frame and keeps it current for everyone else.

Other systems then read the clock to scale their work by real time:

```typescript
import { assertResource, collectEntities, defineSystem, getResourceValue } from "iris-ecs";

const moveEntitiesScaled = defineSystem("moveEntitiesScaled", (world) => {
  assertResource(world, Time);

  const delta = getResourceValue(world, Time, "delta");

  for (const entity of collectEntities(world, [Position, Velocity])) {
    const position = getComponentView(world, entity, Position, "value");
    const velocity = getComponentView(world, entity, Velocity, "value");

    position[0] += velocity[0] * delta;
    position[1] += velocity[1] * delta;

    markComponentChanged(world, entity, Position);
  }
});
```

And the score is a resource because there is only ever one of it. It would not
make sense as a component on some entity:

```typescript
import { addSystem, assertResource, collectEntities, defineSystem, getResourceValue, setResourceValue } from "iris-ecs";

const awardScore = defineSystem("awardScore", (world) => {
  assertResource(world, Score);

  const destroyed = collectEntities(world, [Asteroid, Dead]).length;
  const value = getResourceValue(world, Score, "value");

  setResourceValue(world, Score, "value", value + destroyed * 100);
});

addSystem(world, awardScore, { before: [despawnDead] });
```

Each asteroid marked `Dead` this frame is worth a hundred points, so we order
this system before the one that removes them.

`hasResource` checks for an optional resource, and `removeResource` takes one
away.

## Queries

All the data for our entities lives in components. We get at it from our
systems through queries.

A query is a list of terms. The simplest term is a component, and the query
matches every entity that has all of them. `collectEntities` returns the
matches as an array:

```typescript
import { collectEntities, defineSystem } from "iris-ecs";

const bounceOffEdges = defineSystem("bounceOffEdges", (world) => {
  for (const entity of collectEntities(world, [Position, Velocity])) {
    const [x, y] = getComponentValue(world, entity, Position, "value");
    const [vx, vy] = getComponentValue(world, entity, Velocity, "value");

    if (x < 0 || x > 800) {
      setComponentValue(world, entity, Velocity, "value", [-vx, vy]);
    }

    if (y < 0 || y > 600) {
      setComponentValue(world, entity, Velocity, "value", [vx, -vy]);
    }
  }
});
```

This query says: fetch me every entity that has both a `Position` and a
`Velocity`.

### Excluding components

`not` excludes entities that have a component:

```typescript
import { collectEntities, defineSystem, not } from "iris-ecs";

const moveLiving = defineSystem("moveLiving", (world) => {
  for (const entity of collectEntities(world, [Position, Velocity, not(Dead)])) {
    const [x, y] = getComponentValue(world, entity, Position, "value");
    const [vx, vy] = getComponentValue(world, entity, Velocity, "value");

    setComponentValue(world, entity, Position, "value", [x + vx, y + vy]);
  }
});
```

Now the query says: every entity with a `Position` and a `Velocity` that does
not have `Dead`. Anything that died stops where it is while its explosion
plays.

### Matching one of several

`or` matches entities that have at least one of the listed components. Bullets
and asteroids should both be removed once they drift off screen, but the ship
should not, so we ask for either tag:

```typescript
import { collectEntities, defineSystem, destroyEntity, or } from "iris-ecs";

const despawnOffscreen = defineSystem("despawnOffscreen", (world) => {
  for (const entity of collectEntities(world, [Position, or(Bullet, Asteroid)])) {
    const [x, y] = getComponentValue(world, entity, Position, "value");

    if (x < 0 || x > 800 || y < 0 || y > 600) {
      destroyEntity(world, entity);
    }
  }
});
```

Each matching entity shows up once, even if it has both. Because we do not know
which one matched, the components inside `or` are not narrowed, so if we need
to read from one of them we check it with `hasComponent` first.

### Getting one entity

When we expect a single match, such as the player ship, `queryFirstEntity`
returns the first one or `undefined`:

```typescript
import { assertEntity, defineSystem, queryFirstEntity } from "iris-ecs";

const keepShipOnScreen = defineSystem("keepShipOnScreen", (world) => {
  const ship = queryFirstEntity(world, [Ship, Position, not(Dead)]);

  assertEntity(world, ship);

  const [x, y] = getComponentValue(world, ship, Position, "value");

  setComponentValue(world, ship, Position, "value", [
    Math.min(Math.max(x, 0), 800),
    Math.min(Math.max(y, 0), 600),
  ]);
});
```

If several entities match, we get whichever comes first in storage, so this is
for cases where we expect exactly one.

## Events

Events let us separate what happened from what should happen about it. One
system emits an event, and any number of other systems read it and react,
without either side knowing about the other.

We define an event much like a component. An event without a schema is a plain
signal. An event with a schema carries data:

```typescript
import { defineEvent, Type } from "iris-ecs";

const FireRequested = defineEvent("FireRequested");

const Collision = defineEvent("Collision", {
  schema: { a: Type.u32<EntityId>(), b: Type.u32<EntityId>() },
});

const AsteroidDestroyed = defineEvent("AsteroidDestroyed", {
  schema: { position: Type.f32(2) },
});
```

`Collision` stores the two entities involved as `u32` fields, which is how we
put an entity reference into an event or a component.

### Emitting events

We emit an event with `emitEvent`. If the event has a schema, we pass its data:

```typescript
import { collectEntities, defineSystem, destroyEntity, emitEvent } from "iris-ecs";

const destroyAsteroids = defineSystem("destroyAsteroids", (world) => {
  for (const asteroid of collectEntities(world, [Asteroid, Dead, Position])) {
    const position = getComponentValue(world, asteroid, Position, "value");

    emitEvent(world, AsteroidDestroyed, { position });
    destroyEntity(world, asteroid);
  }
});
```

This system does not know who wants to hear about destroyed asteroids, it just
records where it happened and moves on.

Input usually comes from outside the world. Emitting from there works the same
way:

```typescript
window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    emitEvent(world, FireRequested);
  }
});
```

The handler only says what happened. A system decides what to do about it.

### Reading events

Inside a system, `readEvents` hands each unread event to a callback:

```typescript
import { createEntity, defineSystem, queryFirstEntity, readEvents } from "iris-ecs";

const handleFire = defineSystem("handleFire", (world) => {
  const ship = queryFirstEntity(world, [Ship, Position, not(Dead)]);

  assertEntity(world, ship);

  readEvents(world, FireRequested, () => {
    const [x, y] = getComponentValue(world, ship, Position, "value");

    createEntity(world, [
      Bullet,
      [Position, { value: [x, y] }],
      [Velocity, { value: [0, -8] }],
      [Lifetime, { remaining: 90 }],
    ]);
  });
});
```

Each fire request becomes a bullet at the ship's position.

Iris tracks what each system has read, not what the world has read. So two
systems can both read the same events and both see all of them:

```typescript
import { createEntity, defineSystem, readEvents } from "iris-ecs";

const spawnExplosions = defineSystem("spawnExplosions", (world) => {
  readEvents(world, AsteroidDestroyed, ({ position }) => {
    createEntity(world, [
      Explosion,
      [Position, { value: position }],
      [Lifetime, { remaining: 30 }],
    ]);
  });
});

const spawnDebris = defineSystem("spawnDebris", (world) => {
  readEvents(world, AsteroidDestroyed, ({ position }) => {
    for (let i = 0; i < 2; i++) {
      createEntity(world, [
        Asteroid,
        [Position, { value: position }],
        [Velocity, { value: [Math.random() - 0.5, Math.random() - 0.5] }],
      ]);
    }
  });
});
```

So `spawnExplosions` and `spawnDebris` can both react to one
`AsteroidDestroyed` without coordinating.

Because reading is tracked per system, **`readEvents` only works inside a
running system**. Called from outside, there is no system to track, and it
returns nothing.

### Other ways to read

Sometimes only the newest event matters. If the window was resized three times
since we last looked, only the last size is worth acting on. `readLastEvent`
returns the newest unread event and marks the rest read:

```typescript
import { defineEvent, defineSystem, readLastEvent, Type } from "iris-ecs";

const ViewportResized = defineEvent("ViewportResized", {
  schema: { width: Type.f32(), height: Type.f32() },
});

const resizeCanvas = defineSystem("resizeCanvas", (world) => {
  const latest = readLastEvent(world, ViewportResized);

  if (latest === undefined) {
    return;
  }

  canvas.width = latest.width;
  canvas.height = latest.height;
});
```

Sometimes we want to throw events away. While the game is paused, collisions
that pile up should not be processed once it resumes. `clearEvents` discards
them without reading:

```typescript
import { clearEvents, defineSystem } from "iris-ecs";

const dropCollisionsWhilePaused = defineSystem("dropCollisionsWhilePaused", (world) => {
  assertResource(world, GameState);

  if (getResourceValue(world, GameState, "paused")) {
    clearEvents(world, Collision);
  }
});
```

`hasEvents` and `countEvents` peek at the unread events without marking
anything read, and `collectEvents` returns them as an array and marks them
read, for the times we need the whole batch at once.

### How long events live

Events live for two frames, so a system that runs later in the same frame sees
them, and so does any system next frame, and after that they are gone.

This means a system does not need to run in any particular order relative to
the emitter. It also means **a system that runs every other frame will miss
events**. For that case a component that the system polls is the better tool.

## Change detection

Sometimes a system only cares about what changed since it last ran, e.g. a
physics engine that needs to know about new bodies, or a renderer that needs to
know which sprites moved. Iris tracks this per system, the same way it tracks
events, so like events it only works inside a running system.

### Added components

`added` is a query term that matches entities which gained a component since
this system last ran:

```typescript
import { added, collectEntities, defineSystem } from "iris-ecs";

const initColliders = defineSystem("initColliders", (world) => {
  for (const entity of collectEntities(world, [added(Position)])) {
    physics.addBody(entity);
  }
});
```

Here, every new entity with `Position` gets a physics body.

### Changed components

`changed` matches entities where a component was added or written since this
system last ran:

```typescript
import { changed, collectEntities, defineSystem } from "iris-ecs";

const syncSprites = defineSystem("syncSprites", (world) => {
  for (const entity of collectEntities(world, [Sprite, changed(Position)])) {
    const [x, y] = getComponentValue(world, entity, Position, "value");

    renderer.move(entity, x, y);
  }
});
```

A write through `setComponentValue` counts as a change. A write through a view
counts once we call `markComponentChanged`. Entities that did not move are
skipped entirely.

### Removed components

Removal works differently, because when a component is removed the entity moves
to a different group and the old data is gone, so there is nothing left to
query. Instead, `removed` gives us an event, and we read it like any other:

```typescript
import { defineSystem, readEvents, removed } from "iris-ecs";

const cleanupColliders = defineSystem("cleanupColliders", (world) => {
  readEvents(world, removed(Position), ({ entity }) => {
    physics.removeBody(entity);
  });
});
```

The payload carries the entity ID, but the entity itself may already be
destroyed by the time we read it, so we treat the ID as a key rather than as
something to read from.

## Relations

Iris stores entities and components in flat arrays, which makes it awkward to
express that one entity belongs to another, e.g. that a turret is mounted on a
ship, a bullet was fired by a player, or an asteroid is chasing the ship.
Relations turn those connections into components we can query.

### Pairs

We define a relation with `defineRelation`. To attach it we combine it with a
target entity using `pair`, and the result goes on like any other component:

```typescript
import { addComponent, createEntity, defineRelation, defineSystem, pair } from "iris-ecs";

const ChildOf = defineRelation("ChildOf", { exclusive: true, onDeleteTarget: "delete" });

const mountTurret = defineSystem("mountTurret", (world) => {
  for (const ship of collectEntities(world, [added(Ship)])) {
    const turret = createEntity(world, [[Position, { value: [0, 0] }]]);

    addComponent(world, turret, pair(ChildOf, ship));
  }
});
```

`pair(ChildOf, ship)` is a component that means "child of this particular
ship". Every new ship gets one turret attached to it.

Because a pair is a component, we can query by it. This finds every child of a
given ship and keeps it in place:

```typescript
import { collectEntities, defineSystem, pair } from "iris-ecs";

const followParent = defineSystem("followParent", (world) => {
  for (const ship of collectEntities(world, [Ship, Position])) {
    const [x, y] = getComponentValue(world, ship, Position, "value");

    for (const child of collectEntities(world, [pair(ChildOf, ship), Position])) {
      setComponentValue(world, child, Position, "value", [x, y - 12]);
    }
  }
});
```

To go the other way, from an entity to its targets, we use
`getRelationTargets`:

```typescript
import { defineRelation, defineSystem, getRelationTargets, pair } from "iris-ecs";

const Targeting = defineRelation("Targeting", { exclusive: true });

const retarget = defineSystem("retarget", (world) => {
  const ship = queryFirstEntity(world, [Ship, not(Dead)]);

  assertEntity(world, ship);

  for (const asteroid of collectEntities(world, [Asteroid])) {
    addComponent(world, asteroid, pair(Targeting, ship));
  }
});

const chaseTargets = defineSystem("chaseTargets", (world) => {
  for (const asteroid of collectEntities(world, [Asteroid, Position, Velocity])) {
    const [target] = getRelationTargets(world, asteroid, Targeting);

    if (target === undefined) {
      continue;
    }

    assertComponent(world, target, Position);

    const [tx, ty] = getComponentValue(world, target, Position, "value");
    const [x, y] = getComponentValue(world, asteroid, Position, "value");

    setComponentValue(world, asteroid, Velocity, "value", [
      Math.sign(tx - x) * 0.5,
      Math.sign(ty - y) * 0.5,
    ]);
  }
});
```

`retarget` points every asteroid at the ship, and `chaseTargets` reads that
target back and steers toward it.

### Exclusive relations

`Targeting` above is `exclusive`, so an entity can have one target for it at a
time. Adding a new pair replaces the old one, and retargeting needs nothing
more.

Without `exclusive`, an entity can hold any number of pairs for the same
relation. Which one we want depends on the direction we are describing. A
bullet is fired by one thing, but a ship can be targeted by many asteroids.

### What happens when the target dies

`onDeleteTarget` decides what happens to the holder of a pair when its target is
destroyed. The default `"remove"` drops the pair and leaves the holder alive.
`"delete"` destroys the holder too.

A turret should not outlive its ship, so `ChildOf` uses `"delete"`. An asteroid
should keep flying when the ship it was chasing dies, so `Targeting` keeps the
default.

### Wildcards

To match any target, we use `Wildcard` in the target position. This version of
`followParent` handles every child of anything, without looping over ships
first:

```typescript
import { collectEntities, defineSystem, getRelationTargets, pair, Wildcard } from "iris-ecs";

const followParents = defineSystem("followParents", (world) => {
  for (const child of collectEntities(world, [pair(ChildOf, Wildcard), Position])) {
    const [parent] = getRelationTargets(world, child, ChildOf);

    assertEntity(world, parent);
    assertComponent(world, parent, Position);

    const [x, y] = getComponentValue(world, parent, Position, "value");

    setComponentValue(world, child, Position, "value", [x, y - 12]);
  }
});
```

`Wildcard` works in the relation position too. `pair(Wildcard, ship)` matches
every entity with any relation pointing at the ship. When a query hands us a
pair we did not build ourselves, `getPairTarget` pulls the target out of it and
`getPairRelation` pulls the relation.

### Relations with data

A relation can carry data, the same way a component can. Say a drone circles
the ship. The radius and speed of that orbit belong to the link between drone
and ship, not to either of them, so we give the relation a schema and each pair
holds its own values:

```typescript
import { addComponent, createEntity, defineRelation, defineSystem, pair, Type } from "iris-ecs";

const Orbiting = defineRelation("Orbiting", {
  schema: { radius: Type.f32(), speed: Type.f32() },
  exclusive: true,
  onDeleteTarget: "delete",
});

const spawnDrones = defineSystem("spawnDrones", (world) => {
  for (const ship of collectEntities(world, [added(Ship)])) {
    const drone = createEntity(world, [[Position, { value: [0, 0] }]]);

    addComponent(world, drone, pair(Orbiting, ship), { radius: 40, speed: 2 });
  }
});
```

To move the drone we read the pair's data back with the same accessors we use
for any component. The pair we read from is the one with the drone's actual
target, which we get from `getRelationTargets`:

```typescript
import { collectEntities, defineSystem, getRelationTargets, pair, Wildcard } from "iris-ecs";

const orbit = defineSystem("orbit", (world) => {
  assertResource(world, Time);

  const elapsed = getResourceValue(world, Time, "elapsed");

  for (const drone of collectEntities(world, [pair(Orbiting, Wildcard), Position])) {
    const [target] = getRelationTargets(world, drone, Orbiting);

    assertEntity(world, target);
    assertComponent(world, target, Position);

    const link = pair(Orbiting, target);

    assertComponent(world, drone, link);

    const radius = getComponentValue(world, drone, link, "radius");
    const speed = getComponentValue(world, drone, link, "speed");
    const [x, y] = getComponentValue(world, target, Position, "value");
    const angle = elapsed * speed;

    setComponentValue(world, drone, Position, "value", [
      x + Math.cos(angle) * radius,
      y + Math.sin(angle) * radius,
    ]);
  }
});
```

Two drones on the same ship can orbit at different radii, because the values
live on each pair rather than on the ship.

## Scheduling

Every frame, Iris runs a fixed sequence of schedules. Each system we register
belongs to one of them, and we control when a system runs by choosing which.

```
First -> PreUpdate -> Update -> PostUpdate -> Last
```

`Update` is the default. Two more schedules live outside the loop, `Startup`
which runs once before the first frame, and `Shutdown` which runs once when we
stop the world.

Putting our systems into schedules looks like this:

```typescript
import { addSystem, addSystems, First, Last, PostUpdate, Shutdown, Startup } from "iris-ecs";

const saveHighScore = defineSystem("saveHighScore", (world) => {
  assertResource(world, Score);

  localStorage.setItem("highScore", String(getResourceValue(world, Score, "value")));
});

addSystems(world, [initResources, spawnShip, spawnAsteroids], { schedule: Startup });

addSystem(world, tickTime, { schedule: First });
addSystems(world, [handleFire, moveEntities, expireLifetimes]);
addSystems(world, [applyHits, markDead, despawnDead], { schedule: PostUpdate });
addSystem(world, syncSprites, { schedule: Last });
addSystem(world, saveHighScore, { schedule: Shutdown });
```

`addSystems` registers a list with the same options. The clock ticks in
`First`, gameplay runs in `Update`, consequences resolve in `PostUpdate`, and
rendering reads the result in `Last`. Most ordering questions answer themselves
once systems are in the right phase.

### Ordering within a schedule

Within a schedule, systems run in the order we added them. When that is not
enough, we say what has to come first with `before` and `after`:

```typescript
import { addSystem } from "iris-ecs";

addSystem(world, applyHits, { schedule: PostUpdate });
addSystem(world, markDead, { schedule: PostUpdate, after: [applyHits] });
addSystem(world, despawnDead, { schedule: PostUpdate, after: [markDead] });
addSystem(world, awardScore, { schedule: PostUpdate, before: [despawnDead] });
```

Damage is applied, then deaths are marked, then the score is awarded, and only
then are the dead removed. `before` and `after` accept systems, system sets, or
names. If the constraints form a cycle, Iris throws `IrisCircularDependency`.

To register the same system twice, we give the second copy a `name`.

### System sets

When many systems share an ordering rule, writing `after` on each one gets
tedious. A system set is a label we attach to systems, and we order the sets
against each other once:

```typescript
import { addSystem, addSystems, addSystemSet, defineSystemSet } from "iris-ecs";

const Simulation = defineSystemSet("Simulation");
const Cleanup = defineSystemSet("Cleanup");

addSystemSet(world, Simulation, { schedule: PostUpdate });
addSystemSet(world, Cleanup, { schedule: PostUpdate, after: [Simulation] });

addSystem(world, applyHits, { set: Simulation });
addSystem(world, markDead, { set: Simulation, after: [applyHits] });
addSystems(world, [despawnDead, cleanupColliders], { set: Cleanup });
```

Every system in `Cleanup` now runs after every system in `Simulation`. Systems
inside a set still honor their own `before` and `after`. A system takes either a
`schedule` or a `set`, not both, because the set already knows its schedule.

### Conditions

Some systems should sit out under certain conditions, e.g. nothing in the
simulation should move while the game is paused. We define the check once as a
condition and attach it wherever it applies:

```typescript
import { addSystem, addSystemSet, defineCondition, every, once } from "iris-ecs";

const gameIsRunning = defineCondition("gameIsRunning", (world) => {
  return getResourceValue(world, GameState, "paused") === false;
});

addSystemSet(world, Simulation, { schedule: PostUpdate, condition: gameIsRunning });
addSystem(world, moveEntities, { condition: gameIsRunning });

addSystem(world, retarget, { condition: every(10) });
addSystem(world, spawnAsteroids, { condition: once() });
```

A condition is checked at most once per schedule per frame, and every system
using that same definition shares the answer. `every(10)` passes on every tenth
check, so asteroids retarget ten times less often than they move. `once` passes
the first time only.

Conditions run outside any system. They can read resources and components, but
they cannot read events or use change detection.

### Custom schedules

The five built in phases cover most games. When we want a phase of our own, we
define it and insert it next to an existing one:

```typescript
import { addSystem, defineSchedule, insertScheduleAfter, Update } from "iris-ecs";

const Combat = defineSchedule("Combat");

insertScheduleAfter(world, Combat, Update);
addSystem(world, applyHits, { schedule: Combat });
```

The pipeline is now `First`, `PreUpdate`, `Update`, `Combat`, `PostUpdate`,
`Last`. `insertScheduleBefore` inserts on the other side of the anchor.

### Async systems

A system can be `async`. Iris waits for it before moving on to the next:

```typescript
import { addSystem, defineComponent, defineSystem, Startup, Type } from "iris-ecs";

const Assets = defineComponent("Assets", {
  schema: { ship: Type.ref<ImageBitmap>() },
});

const loadAssets = defineSystem("loadAssets", async (world) => {
  const response = await fetch("/assets/ship.png");
  const blob = await response.blob();

  addResource(world, Assets, { ship: await createImageBitmap(blob) });
});

addSystem(world, loadAssets, { schedule: Startup });
```

Loading like this is a good fit for `Startup`, because the frame loop only
begins once every `Startup` system has finished, so the systems that need the
assets can count on the resource being there.

### Running the world

`run` starts the loop on `requestAnimationFrame`. Each frame runs the pipeline,
then retires the events from the frame before:

```typescript
import { run } from "iris-ecs";

run(world);
```

To pause, we `suspend`. The loop stops after the current frame, `Shutdown` does
not run, and calling `run` again picks up where we left off without running
`Startup` again:

```typescript
import { run, suspend } from "iris-ecs";

await suspend(world);

// Later, from a menu or when the tab becomes visible again.
run(world);
```

To end a session, e.g. on game over, when going back to the main menu, or when
tearing a world down in a test, we `stop`. `Shutdown` runs, and the next `run`
starts over with `Startup`:

```typescript
import { stop } from "iris-ecs";

await stop(world);
```

Both wait for the frame in progress to finish before they resolve.

## Running outside the browser

Nothing in Iris depends on a browser, so on a server or in a test we can choose
a different frame source or step frames ourselves.

`createTimeoutDriver` ticks on a timer instead of `requestAnimationFrame`:

```typescript
import { createTimeoutDriver, run } from "iris-ecs";

run(world, createTimeoutDriver(50));
```

In a test we usually do not want a loop at all. `runOnce` runs `Startup` on the
first call and the pipeline on every call:

```typescript
import { runOnce } from "iris-ecs";

await runOnce(world);
await runOnce(world);
```

A test creates a world, adds the systems under test, steps a few frames, and
reads the result, with no timers to mock and nothing to wait for.

Between test cases, or between levels in a game, we clear the world and start
fresh with `resetWorld`:

```typescript
import { resetWorld } from "iris-ecs";

resetWorld(world);
```

This destroys every entity, drops every resource, and discards pending events,
while our component, relation, and event definitions survive, and so do our
registered systems.

A `FrameDriver` is an object with `request` and `cancel`, the same shape as
`requestAnimationFrame` and `cancelAnimationFrame`. Writing one lets us drive
Iris from a worker, a game engine, or anything else that ticks.

## Actions

Spawning a bullet takes a few lines, and more than one system needs to do it.
Rather than copy the lines around, we put them in an action.

`defineActions` takes a function from a world to an object of methods. The
methods close over the world, so callers do not pass it in:

```typescript
import { createEntity, defineActions, pair } from "iris-ecs";

const FiredBy = defineRelation("FiredBy");

const spawnActions = defineActions((world) => ({
  bullet(x: number, y: number, owner: EntityId) {
    return createEntity(world, [
      Bullet,
      [Position, { value: [x, y] }],
      [Velocity, { value: [0, -8] }],
      [Lifetime, { remaining: 90 }],
      pair(FiredBy, owner),
    ]);
  },
  asteroid(x: number, y: number) {
    return createEntity(world, [
      Asteroid,
      [Position, { value: [x, y] }],
      [Velocity, { value: [Math.random() - 0.5, Math.random() - 0.5] }],
      [Health, { current: 30, max: 30 }],
    ]);
  },
}));
```

Inside a system we ask for the actions for this world and call them:

```typescript
import { defineSystem, queryFirstEntity, readEvents } from "iris-ecs";

const handleFireWithActions = defineSystem("handleFireWithActions", (world) => {
  const spawn = spawnActions(world);
  const ship = queryFirstEntity(world, [Ship, Position, not(Dead)]);

  assertEntity(world, ship);

  readEvents(world, FireRequested, () => {
    const [x, y] = getComponentValue(world, ship, Position, "value");

    spawn.bullet(x, y - 16, ship);
  });
});
```

`spawnActions(world)` builds the object the first time and returns the same one
after that. It works from setup code as well as from systems.

Anything we would otherwise copy between systems is a candidate, e.g. spawn
helpers, small state machines, or reads that combine several components.

## Observers

Observers are callbacks that fire inside Iris itself, at the moment something
happens. They sit underneath systems and events, and we mostly reach for them
when building tooling, e.g. a profiler, a debug overlay, an editor, or a bridge
to another library.

We register one with `registerObserverCallback` and remove it with
`unregisterObserverCallback`:

```typescript
import { registerObserverCallback, unregisterObserverCallback } from "iris-ecs";
import type { Observer } from "iris-ecs";

const timings = new Map<string, number>();

const recordTiming: Observer<"systemFinished"> = (systemId, _schedule, duration) => {
  timings.set(systemId, duration);
};

registerObserverCallback(world, "systemFinished", recordTiming);

registerObserverCallback(world, "frameFailed", (error) => {
  console.error("Frame failed", error);
});

// Later, when the profiler closes.
unregisterObserverCallback(world, "systemFinished", recordTiming);
```

We now get the duration of every system, every frame, without touching the
systems themselves.

| Event | Payload | When |
|-------|---------|------|
| `entityCreated` | `(entity)` | After the ID is allocated, before initial components attach |
| `entityDestroying` | `(entity)` | Before cleanup. The entity is alive and readable |
| `entityDestroyed` | `(entity)` | After cleanup. The entity is gone |
| `componentAdded` | `(component, entity)` | After a component is attached |
| `componentRemoved` | `(component, entity)` | After a component is removed |
| `componentChanged` | `(component, entity)` | After a value write, including the first one in `addComponent` |
| `archetypeCreated` | `(archetype)` | After a new storage group is created |
| `archetypeDestroyed` | `(archetype)` | Before a storage group is torn down |
| `filterCreated` | `(filter)` | After a query filter is first built |
| `worldReset` | `(world)` | After `resetWorld` |
| `scheduleStarted` | `(schedule)` | Before a schedule runs its systems |
| `scheduleFinished` | `(schedule, duration)` | After a schedule finishes |
| `systemStarted` | `(systemId, schedule)` | Before a system runs |
| `systemFinished` | `(systemId, schedule, duration)` | After a system finishes |
| `frameFailed` | `(error)` | When a system throws and the frame stops |

Callbacks fire synchronously, in the middle of whatever caused them. A callback
may unregister itself while it runs, but it must not add or remove other
callbacks for the same event during dispatch.

For game logic, events and change detection are the better tools. They run
inside systems, at a predictable point in the frame.

## Errors

Iris throws when we ask for something it cannot do. Every error extends
`IrisError`, and each one also extends a category, so we can catch broadly or
narrowly:

```typescript
import { IrisError, IrisNotFound } from "iris-ecs";

const asteroid = createEntity(world, [Asteroid]);

destroyEntity(world, asteroid);

try {
  destroyEntity(world, asteroid);
} catch (error) {
  if (error instanceof IrisNotFound) {
    // The asteroid was already gone, which is fine.
  } else if (error instanceof IrisError) {
    throw error;
  }
}
```

The categories are `IrisNotFound`, `IrisDuplicate`, `IrisInvalidArgument`,
`IrisInvalidState`, and `IrisLimitExceeded`. The specific classes, such as
`IrisEntityNotFound` or `IrisCircularDependency`, are listed in the JSDoc of
each function that throws them.

## Archetypes

We never touch archetypes directly, but knowing how Iris stores things explains
the costs of structural changes and views.

An **archetype** is the group of entities that have exactly the same set of
components. All entities with `Position` and `Velocity` share one archetype.
Add `Health` and we are in a different one.

```
Archetype [Position, Velocity]
┌──────────┬──────────────────┬──────────────────┐
│ Entity   │ Position (vec2)  │ Velocity (vec2)  │
├──────────┼──────────────────┼──────────────────┤
│ bullet1  │  [10, 5]         │  [0, -8]         │
│ bullet2  │  [15, 8]         │  [0, -8]         │
└──────────┴──────────────────┴──────────────────┘

Archetype [Position, Velocity, Health]
┌──────────┬──────────────────┬──────────────────┬─────────┐
│ Entity   │ Position (vec2)  │ Velocity (vec2)  │ Health  │
├──────────┼──────────────────┼──────────────────┼─────────┤
│ ship     │  [400, 300]      │  [0, 0]          │   100   │
│ asteroid │  [50, 20]        │  [-1, 0]         │    30   │
└──────────┴──────────────────┴──────────────────┴─────────┘
```

Inside an archetype, each component field is a column. Numeric columns are
typed arrays, and a vector field lays its elements out one after another:
`[x0, y0, x1, y1, ...]`. A query visits the archetypes that match, and the
entities it hands back are grouped by archetype, so a system reading the same
field from each of them touches one typed array after another rather than
hopping between scattered objects. JavaScript makes no promises about memory
layout or caches, but in practice engines back a typed array with a single
block of memory, and this is why numeric data lives in typed arrays.

Working out which archetypes match happens once per query, the first time it
runs. Iris caches the result and updates it when a new archetype appears, so
after that running the same query in any system is a lookup, and there is no
reason to hold on to query results between frames ourselves.

Adding or removing a component costs more than writing a value because the
entity's data has to be copied out of one archetype's columns and into
another's. For the same reason, a view is only valid until the next structural
change. The array it points into may no longer hold that entity.

The practical advice follows from the layout: entities that update every frame
should keep a stable set of components, so state that flips rarely is a good
fit for a tag, while state that flips often is a better fit for a field.

## Everything is an ID

Entities are numbers, and so is everything else we define. A tag, a component,
a relation, and a pair are all IDs from the same space as entities, and they
all share the `EntityId` type. Iris takes this idea from Flecs, and a few
things only make sense because of it.

A component definition is an ID, so a component can have components. A
resource is one of these. `addResource(world, Time, ...)` attaches the `Time`
data to the `Time` ID itself. There is exactly one per world because there is
only one `Time` ID, and `collectEntities(world, [Time])` finds it for the same
reason.

A pair is an ID computed from a relation and a target. `pair(ChildOf, ship)`
allocates nothing and always produces the same number for the same inputs, so
we can use it as a query term.

Each ID is a single 32-bit number, where a few bits say what kind of thing it
is and the rest hold a slot and, for entities, a generation. The generation
wraps after 256 reuses of the same slot, so an ID held for a very long time
could in principle look valid again, which is one more reason to check IDs soon
after receiving them.

The layout sets the limits. A world can hold about a million live entities, and
a program can define about a million components and tags, but only 256
relations. Each limit throws an `IrisLimitExceeded` error when crossed.

## Acknowledgments

Iris stands on ideas from a few excellent ECS projects.

- [Flecs](https://github.com/SanderMertens/flecs) by Sander Mertens. His
  [articles](https://ajmmertens.medium.com/) on archetype storage and the
  "everything is an entity" model shaped the core. Entity naming, ID encoding,
  and resources follow Flecs closely.
- [Bevy](https://github.com/bevyengine/bevy). The change detection API, system
  scheduling with ordering constraints, and the event system draw heavily from
  Bevy's design.
- [Koota](https://github.com/pmndrs/koota). My introduction to ECS, and proof
  of how far TypeScript ergonomics can go. The actions API comes directly from
  Koota.
- [Jecs](https://github.com/Ukendio/jecs). Its
  [thesis](https://github.com/Ukendio/jecs/blob/b7a5785dbbeefa4cb035673f4eec4f93440acc48/thesis/drafts/1/paper.pdf)
  on archetype internals, ID encoding, and relation semantics informed the
  implementation.

## License

[MIT](https://github.com/r04423/iris/blob/main/LICENSE)
