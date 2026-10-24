# Patterns

Recipes for problems most applications meet. Each one composes ordinary Iris
parts: components, resources, relations, events, systems, and conditions.
Reach for these before inventing a mechanism.

## Contents

- Objects outside the world
- Injected services
- Syncing outside data
- Shared spawn logic
- Requests as events
- App states
- Entity states
- Reacting once
- Fixed timestep
- Coming from Bevy or flecs

---

## Objects outside the world

Meshes, DOM nodes, physics bodies, and audio voices belong to entities but live
in another library. Keep them in a registry resource keyed by entity, and let
one system keep it in step with a component:

```ts
// render/resources.ts
export const Sprites = defineComponent("Sprites", {
  schema: {
    // Keyed by EntityId, which both query results and removed() payloads are
    byEntity: Type.ref<Map<EntityId, PIXI.Sprite>>(),
  },
});

// render/systems/sync-sprites.ts
export const syncSprites = defineSystem("syncSprites", (world) => {
  assertResource(world, Sprites);

  const byEntity = getResourceValue(world, Sprites, "byEntity");

  // Removals first: an entity that lost and regained SpriteSource this frame
  // must end up with a new sprite, not a destroyed one
  readEvents(world, removed(SpriteSource), ({ entity }) => {
    // The entity may already be dead, and only the map still knows its sprite
    byEntity.get(entity)?.destroy();
    byEntity.delete(entity);
  });

  for (const entity of collectEntities(world, [SpriteSource, added(SpriteSource)])) {
    const texture = getComponentValue(world, entity, SpriteSource, "texture");

    byEntity.set(entity, new PIXI.Sprite(texture));
  }

  // Only entities that moved pay for the write to the outside object
  for (const entity of collectEntities(world, [SpriteSource, changed(Position)])) {
    const [x, y] = getComponentValue(world, entity, Position, "value");

    byEntity.get(entity)?.position.set(x, y);
  }
});
```

- **Never gate the sync system** with a condition or `every(n)`. Removal
  events expire after the next frame, and a skipped run leaks the object.
- **Run it after every writer**, usually in `Last`, or it reacts a frame late.
- **Dispose everything in a `Shutdown` system.** `resetWorld` sends no
  `removed` events, and `Shutdown` runs on `await stop(world)` while the
  registry still exists.
- A component field typed `Type.ref<T>()` is simpler when the object is
  created with the entity and never shared. The registry wins when creation
  needs other systems' data, or when cleanup must run on destroy.

---

## Injected services

Behavior that differs per app or per test, such as a clock, a random source,
storage, or a platform API, goes in a resource holding an object of functions.
Systems call the service instead of the global:

```ts
// platform/resources.ts
// What the app needs from its host, nothing more
export type Platform = {
  now(): number;
  random(): number;
  save(key: string, value: string): void;
};

export const Services = defineComponent("Services", {
  schema: {
    platform: Type.ref<Platform>(),
  },
});

// platform/systems/init-platform.ts
export const initPlatform = defineSystem("initPlatform", (world) => {
  // Idempotent, so a platform added before the first frame wins
  addResource(world, Services, {
    platform: createBrowserPlatform(),
  });
});

// time/systems/tick-time.ts
export const tickTime = defineSystem("tickTime", (world) => {
  assertResource(world, Services);
  assertResource(world, Time);

  const now = getResourceValue(world, Services, "platform").now();
  const last = getResourceValue(world, Time, "last");

  setResourceValue(world, Time, "delta", (now - last) / 1000);
  setResourceValue(world, Time, "last", now);
});
```

A test, or a different host app, calls `addResource` with its own platform
before the first frame. `addResource` never overwrites, so `initPlatform` keeps
it. A resource needs a schema, so the service always sits in a field.

---

## Syncing outside data

When entities mirror records from somewhere else, such as a server, a document
model, or an editor's scene, name each entity after its record. Iris keeps the
name index and frees a name when its entity is destroyed, so there is no map to
maintain. Each snapshot then creates, updates, or destroys exactly what
changed:

```ts
// All names share one namespace, so each kind gets a prefix
const todoName = (id: string) => `todo:${id}`;

export const reconcileTodos = defineSystem("reconcileTodos", (world) => {
  if (!hasEvents(world, TodosFetched)) {
    return;
  }

  // Only the newest snapshot matters
  const { records } = readLastEvent(world, TodosFetched);
  const seen = new Set<string>();

  for (const record of records) {
    const name = todoName(record.id);

    seen.add(name);

    // Undefined when the record is new or its entity was destroyed. Passing
    // [Todo] narrows the result, so the read below needs no check
    const existing = lookupByName(world, name, [Todo]);

    if (existing === undefined) {
      const entity = createEntity(world, [
        [Todo, { title: record.title, done: record.done }],
      ]);

      setName(world, entity, name);

      continue;
    }

    // Every write marks a change, so write only real differences
    if (getComponentValue(world, existing, Todo, "done") !== record.done) {
      setComponentValue(world, existing, Todo, "done", record.done);
    }
  }

  // Records missing from the snapshot were deleted at the source
  for (const entity of collectEntities(world, [Todo, Name])) {
    if (!seen.has(getComponentValue(world, entity, Name, "value"))) {
      destroyEntity(world, entity);
    }
  }
});
```

The entity keeps its ID across snapshots, so relations, `changed` queries, and
registry entries that point at it stay valid. `setName` throws
`IrisDuplicateName` when another entity already has the name, which catches a
snapshot that lists one record twice.

---

## Shared spawn logic

A spawn action is the one place an entity kind is assembled. A domain that
builds on another calls the base action, then adds its own parts, without
knowing the base's components:

```ts
// unit/actions.ts
export const unitActions = defineActions((world) => ({
  // The result is typed with every entry, so callers can pass it straight to
  // actions that take EntityWith<typeof Health>
  spawnUnit(x: number, y: number, health: number) {
    return createEntity(world, [
      Unit,
      [Position, { value: [x, y] }],
      [Health, { current: health, max: health }],
    ]);
  },
}));

// archer/actions.ts
export const archerActions = defineActions((world) => ({
  spawnArcher(x: number, y: number) {
    const unit = unitActions(world).spawnUnit(x, y, 60);

    // Narrows unit to Archer and Quiver too
    addComponents(world, unit, [
      Archer,
      [Quiver, { arrows: 12 }],
    ]);

    return unit;
  },
}));
```

Every system that handles units handles archers too, with no inheritance. An
editor works the same way: a timeline domain spawns the base of every track,
and element and animation domains each add their own parts on top.

---

## Requests as events

When many places need the same heavy change, such as spawning, loading, or
destroying, they emit a request, and one system applies it:

```ts
export const SpawnBullet = defineEvent("SpawnBullet", {
  schema: {
    x: Type.f32(),
    y: Type.f32(),
    owner: Type.u32<EntityId>(),
  },
});

export const spawnBullets = defineSystem("spawnBullets", (world) => {
  if (!hasEvents(world, SpawnBullet)) {
    return;
  }

  assertResource(world, CombatConfig);

  const { spawnBullet } = combatActions(world);
  const speed = getResourceValue(world, CombatConfig, "bulletSpeed");

  readEvents(world, SpawnBullet, ({ x, y, owner }) => {
    // The owner may have died since the request
    if (isEntityAlive(world, owner)) {
      spawnBullet(x, y, speed, owner);
    }
  });
});
```

Emitters can be anywhere: systems, DOM handlers, tests. The consumer decides
when the change happens, so put it in the schedule where its effects should
first be seen. A request emitted after the consumer ran is applied next frame.

---

## App states

Menus, levels, and pause screens are app states. Model them like entity states
(see "One state out of several" in `references/relations.md`): an exclusive
relation whose targets are tags, held by a tag definition that stands for the
app.

```ts
// app/relations.ts
// Never added to entities. It only holds the app's own pairs
export const App = defineComponent("App");

export const Phase = defineRelation("Phase", { exclusive: true });

export const Menu = defineComponent("Menu");
export const Playing = defineComponent("Playing");

// app/systems/init-app.ts
export const initApp = defineSystem("initApp", (world) => {
  // resetWorld clears pairs on definitions, so Startup sets the first phase
  addComponent(world, App, pair(Phase, Menu));
});

// app/conditions.ts
export const isPlaying = defineCondition("isPlaying", (world) => {
  return hasComponent(world, App, pair(Phase, Playing));
});

// match/systems/start-match.ts
export const startMatch = defineSystem("startMatch", (world) => {
  // Entering Playing. The query has no App term: a definition never has
  // its own tag
  if (queryFirstEntity(world, [added(pair(Phase, Playing))]) === undefined) {
    return;
  }

  matchActions(world).spawnArena();
});

// menu/systems/close-menu.ts
export const closeMenu = defineSystem("closeMenu", (world) => {
  // Leaving Menu: the replaced pair reports as removed
  if (!hasEvents(world, removed(pair(Phase, Menu)))) {
    return;
  }

  clearEvents(world, removed(pair(Phase, Menu)));

  // Menu entities are children of one root, so one destroy cleans up
  for (const root of collectEntities(world, [MenuRoot])) {
    destroyEntity(world, root);
  }
});
```

Switching is one call: `addComponent(world, App, pair(Phase, Playing))`.

- **"While in a state"** is a condition such as `isPlaying` on a system set.
- **"On enter"** is `added` on the concrete pair, inside a system. Its window
  lasts until the system runs, so the system may sit in the state's gated set.
- **"On exit"** reads `removed` on the concrete pair. That is an event, so the
  system must not be gated by a condition, or it misses the exit.
- **Switch from a system early in the frame**, such as in `First`, so the whole
  frame sees one phase. A condition is evaluated at most once per schedule,
  when first needed, so a switch partway through a schedule may not reach the
  rest of it.
- When nothing reacts to entering or leaving, a resource field such as
  `Type.string<"menu" | "playing">()` read by conditions is enough.

---

## Entity states

One state out of several per entity, such as idle, walking, or running, is an
exclusive relation with tag targets. The recipe is "One state out of several"
in `references/relations.md`.

---

## Reacting once

A tag plus `added` turns a state into a one-time reaction, such as a death
effect:

```ts
export const playDeathEffects = defineSystem("playDeathEffects", (world) => {
  for (const entity of collectEntities(world, [Position, added(Dead)])) {
    const [x, y] = getComponentValue(world, entity, Position, "value");

    emitEvent(world, EffectRequested, { kind: "explosion", x, y });
  }
});
```

The system's first run counts every existing `Dead` tag as added, which is
usually what a newly loaded scene wants. `once()` covers the other one-time
case: a system that runs on the first frame only.

---

## Fixed timestep

Simulations that need steady steps, such as physics, cannot run a schedule
several times per frame. Count the steps once per frame from an accumulator,
and let each fixed system loop:

```ts
export const FixedTime = defineComponent("FixedTime", {
  schema: {
    // Seconds per step
    step: Type.f32(),
    accumulated: Type.f64(),
    // Steps to run this frame
    steps: Type.i32(),
  },
});

// In First, after tickTime
export const countFixedSteps = defineSystem("countFixedSteps", (world) => {
  assertResource(world, Time);
  assertResource(world, FixedTime);

  const step = getResourceValue(world, FixedTime, "step");
  const total = getResourceValue(world, FixedTime, "accumulated") + getResourceValue(world, Time, "delta");

  // A cap, so a long stall does not snowball into ever longer frames
  const steps = Math.min(Math.floor(total / step), 5);

  setResourceValue(world, FixedTime, "steps", steps);
  setResourceValue(world, FixedTime, "accumulated", total - steps * step);
});

export const integrateBodies = defineSystem("integrateBodies", (world) => {
  assertResource(world, FixedTime);

  const steps = getResourceValue(world, FixedTime, "steps");

  if (steps === 0) {
    return;
  }

  const step = getResourceValue(world, FixedTime, "step");

  for (let i = 0; i < steps; i++) {
    for (const entity of collectEntities(world, [Position, Velocity])) {
      const [x, y] = getComponentValue(world, entity, Position, "value");
      const [vx, vy] = getComponentValue(world, entity, Velocity, "value");

      setComponentValue(world, entity, Position, "value", [x + vx * step, y + vy * step]);
    }
  }
});
```

`every(n)` counts frames, not time, so it is no substitute.

---

## Coming from Bevy or flecs

| Elsewhere | In Iris |
|---|---|
| Bevy `Local<T>` | A resource. Systems have no state of their own |
| Bevy one-shot systems, `run_system` | An action, a request event, or a system with `once()` |
| Bevy required components, bundles | A spawn action. See "Shared spawn logic" |
| Bevy `States`, `OnEnter`, `in_state` | See "App states" |
| flecs enum relations, `Exclusive` | An exclusive relation with tag targets. See "Entity states" |
| flecs `ChildOf` with `OnDeleteTarget, Delete` | Define it. See "Hierarchies" in `references/relations.md` |
| flecs `IsA` and prefabs | A spawn action. See "Shared spawn logic" |
| flecs `up` and `cascade` traversal | Recurse from the roots. See "Hierarchies" in `references/relations.md` |
| Bevy `FixedUpdate` | See "Fixed timestep" |
| Bevy `RemovedComponents` | `readEvents(world, removed(C), ...)` |
| Bevy plugins | Registration functions. See "Assembling the frame" in `references/architecture.md` |
| Bevy `resource_changed`, `on_event` conditions | A `changed` or `hasEvents` guard inside the system; conditions see neither |
| Bevy `set_if_neq` | Compare, then write. Every write marks a change |
| Unity enableable components | A `Type.bool()` field, or a tag when the archetype move is acceptable |
| flecs and Unity singletons | Resources |
