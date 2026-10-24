# Architecture

Practices that keep an Iris application easy to grow: how to split it into
domains, where each kind of definition lives, how domains talk, and where the
frame is assembled. They apply to a new project and to Iris code inside a larger
app. When the project already has a structure, fit the feature into it.

## Contents

- Organize by domain
- Folder layout
- How domains talk
- Assembling the frame
- Code at the edges

---

## Organize by domain

A domain is one area of behavior: input, physics, combat, enemy, render, audio.
It owns its data and the systems that change that data.

To find the domain, ask which data the feature changes. The domain that owns
that data owns the systems that write it. Other domains may read it.

A feature that seems to need two domains is usually one of these:

- **Two features** that talk through an event or a shared component.
- **A new domain** that reads both and writes its own data. Collision reads
  physics and combat data and emits hits, so it can be its own domain.
- **A system in the domain whose data it writes**, reading the other domain's
  components.

A new domain is worth creating when a feature brings its own data and at least
one system.

---

## Folder layout

One folder per domain, wherever the project keeps its ECS code:

```
combat/
  components.ts          # components and tags this domain owns
  relations.ts           # defineRelation
  resources.ts           # components used as resources: config, counters
  events.ts              # defineEvent
  schedule.ts            # defineSchedule or defineSystemSet, if needed
  actions.ts             # defineActions: steps shared by several systems
  actions.test.ts
  systems/
    init-combat.ts       # Startup: adds this domain's resources
    apply-hits.ts        # one system per file, named after it
    apply-hits.test.ts
  utils.ts               # pure helpers that never touch the world
  README.md / AGENTS.md  # optional: purpose, data owned, events in and out
shared/
  types.ts               # types and helpers used by several domains
```

A file exists only when the domain needs it. A domain with no events has no
`events.ts`, and a domain with two small systems may keep them in one
`systems.ts`.

| File | Holds | Keep out |
|---|---|---|
| `components.ts` | `defineComponent` calls for entity data and tags | Logic, world access |
| `resources.ts` | `defineComponent` calls for data stored with `addResource` | Module-level state |
| `relations.ts` | `defineRelation` calls, plus the tags used as their targets | Arrays of entity IDs |
| `events.ts` | `defineEvent` calls | Handlers |
| `actions.ts` | `defineActions`: spawn helpers, multi-step changes | Per-frame decisions, which belong in systems |
| `systems/*.ts` | `defineSystem` calls | Registration, which happens where the frame is assembled |
| `utils.ts` | Math, geometry, formatting: plain functions of plain values | Anything that takes `world` |

Data that several domains read still has one owner. A transform belongs to a
`transform` or `physics` domain and a clock to a `time` domain, even when
everything reads them. `shared/` is for code with no data of its own, for
example types, math, and helpers.

All definitions sit at module scope, because names are global to the process
and must be unique. Prefix names when two domains want the same word, e.g.
`EnemyConfig` and `PlayerConfig`.

---

## How domains talk

Domains share data and events. Systems never call each other.

- **Components.** Physics writes `Transform`, render reads it.
- **Events.** Combat emits `EnemyKilled`, and the score and audio domains each
  read it without combat knowing they exist.
- **Actions.** A domain exports actions for operations on its own data, such
  as `spawnBullet`. Other domains call the action instead of building the
  entity by hand, so the recipe lives in one place.

Actions also compose. A base domain's spawn action adds its components, and a
domain built on it calls that action, then adds its own. Each domain keeps its
data private to its actions. See "Shared spawn logic" in
`references/patterns.md`.

Prefer one writing domain per component. When another domain wants to change
it, it emits a request event, or calls the owner's action, so every write to a
component is easy to find.

Import definitions and actions across domains freely. Never import a system to
call it. Systems only run from the schedule.

---

## Assembling the frame

Registration can happen in one module or per domain, whatever fits the project.
What matters is that a reader can find the whole frame: every schedule, the
systems in it, and their order.

A single module suits small programs:

```ts
import {
  addSystem,
  addSystems,
  createWorld,
  First,
  insertScheduleAfter,
  Last,
  PostUpdate,
  PreUpdate,
  run,
  Startup,
  Update,
} from "iris-ecs";
import { Combat } from "./combat/schedule.js";
// ...system imports

// First -> PreUpdate -> Update -> Combat -> PostUpdate -> Last
const world = createWorld();

insertScheduleAfter(world, Combat, Update);

// Each domain adds its resources before the scene spawns
addSystems(world, [
  initTime,
  initCombat,
  spawnPlayer,
], { schedule: Startup });

addSystem(world, tickTime, { schedule: First });

// Input events become data before gameplay reads them
addSystem(world, readInput, { schedule: PreUpdate });

addSystems(world, [
  applyInput,
  handleFire,
]);

addSystem(world, applyHits, { schedule: Combat });
addSystem(world, markDead, {
  schedule: Combat,
  after: [applyHits],
});

addSystem(world, despawnDead, { schedule: PostUpdate });
addSystem(world, render, { schedule: Last });

run(world);
```

Larger programs can give each domain a function that registers its own
systems, like a Bevy plugin, and call those functions in one place:

```ts
// combat/register.ts
export function registerCombat(world: World): void {
  addSystem(world, initCombat, { schedule: Startup });
  addSystem(world, applyHits, { schedule: Combat });
  addSystem(world, markDead, {
    schedule: Combat,
    after: [applyHits],
  });
}

// app.ts
registerTime(world);
registerInput(world);
registerCombat(world);
```

Unconstrained systems in one schedule run in registration order, so the order of
these calls does affect the frame. State the order that matters with schedules,
system sets, and `before` or `after` instead of relying on it. See
`references/scheduling.md`.

---

## Code at the edges

Most programs talk to something outside the world: the DOM, a renderer, the
network, storage.

- **Input comes in as events.** DOM handlers call `emitEvent` and return. A
  `PreUpdate` system turns those events into components or resources that
  gameplay systems read.
- **Output goes out from systems.** A render system in `Last` reads components
  and draws. A save system in `Shutdown` writes to storage.
- **Outside objects live in resources**, added by a `Startup` system, never in
  module-level variables, which leak between worlds and tests. A canvas
  context or a socket goes in a `Type.ref<T>()` field. Objects that belong to
  entities, such as meshes or DOM nodes, go in a registry resource keyed by
  entity. See "Objects outside the world" in `references/patterns.md`.

```ts
// input/events.ts
export const KeyDown = defineEvent("KeyDown", {
  schema: {
    key: Type.string(),
  },
});

// input/systems/init-input.ts
export const initInput = defineSystem("initInput", (world) => {
  addResource(world, InputState, {
    keys: new Set<string>(),
  });

  // The handler only records what happened. Systems decide what it means
  window.addEventListener("keydown", (event) => {
    emitEvent(world, KeyDown, { key: event.key.toLowerCase() });
  });
});
```
