# Systems and queries

A system is a named function of the world that runs once per frame from its
schedule. Systems hold the logic, and queries are how they find their data, so
both live here, along with reading and writing data, events, change detection,
and actions.

## Contents

- What a good system looks like
- Guards
- Queries
- Reading and writing data
- Structural changes
- Events
- Change detection
- Actions
- Performance

---

## What a good system looks like

- **One job, named after it.** `applyHits`, `despawnDead`, `followParents`.
  Prefer splitting a system whose name needs "and". Systems are cheap, and
  small ones are easy to test, reorder, and switch off. Keep two steps in one
  system when they always run together and splitting would only pass data
  between them.
- **No state of its own.** Anything that must survive between frames goes in a
  component or a resource, never in a closure or module variable.
- **Talks only through data.** Systems never call each other. They communicate
  through components, resources, and events.
- **Three parts, in this order:** guards that return when there is nothing to
  do, then inputs read once per run (resources, actions, the single entity),
  then the work: a loop over entities or events. A blank line between parts
  makes each easy to find.

```ts
// combat/systems/apply-hits.ts
import {
  collectEntities,
  defineSystem,
  getComponentValue,
  hasComponent,
  removeComponent,
  setComponentValue,
} from "iris-ecs";
import { Health, Hit, Shield } from "../components.js";

export const applyHits = defineSystem("applyHits", (world) => {
  for (const entity of collectEntities(world, [Hit, Health])) {
    const damage = getComponentValue(world, entity, Hit, "damage");

    // Each hit applies once
    removeComponent(world, entity, Hit);

    if (hasComponent(world, entity, Shield)) {
      const strength = getComponentValue(world, entity, Shield, "strength");

      setComponentValue(world, entity, Shield, "strength", strength - damage);

      continue;
    }

    const current = getComponentValue(world, entity, Health, "current");

    setComponentValue(world, entity, Health, "current", current - damage);
  }
});
```

This system only applies damage. Another system marks the dead, and a third
removes them, so each can be tested and reordered alone.

---

## Guards

Most systems have nothing to do on most frames. Check that first and return.

```ts
// combat/systems/handle-fire.ts
export const handleFire = defineSystem("handleFire", (world) => {
  // Peeking does not consume, so this costs nothing on quiet frames
  if (!hasEvents(world, FireRequested)) {
    return;
  }

  const ship = queryFirstEntity(world, [Ship, Position, not(Dead)]);

  if (ship === undefined) {
    // Unread requests would still fire next frame, after a respawn
    clearEvents(world, FireRequested);

    return;
  }

  // From here ship is typed EntityWith<Ship | Position>, so its reads need no
  // checks and it can go to any action that takes those components

  // A missing config is a bug, so fail loudly instead of returning
  assertResource(world, CombatConfig);

  const { spawnBullet } = combatActions(world);
  const speed = getResourceValue(world, CombatConfig, "bulletSpeed");
  const [x, y] = getComponentValue(world, ship, Position, "value");

  readEvents(world, FireRequested, () => {
    spawnBullet(x, y, speed, ship);
  });
});
```

- A loop over `collectEntities` needs no guard; an empty result does nothing.
- `assertResource` fits data the system cannot work without. `hasResource`
  fits optional data: return when it is missing.
- `hasEvents`, `hasResource`, `hasComponent`, `assertResource`, and
  `assertEntity` narrow types, so reads after them return values instead of
  `undefined`.
- Returning before a read leaves events unread, and they stay readable until
  they expire next frame. Call `clearEvents` before returning when the guard
  should discard them.

When the same on/off rule applies to many systems, such as a pause or a
feature flag, use a condition instead of repeating the guard. See
`references/scheduling.md`.

---

## Queries

A query is an array of terms. `collectEntities` returns a snapshot array of the
matches, and `queryFirstEntity` returns one match or `undefined`.

```ts
collectEntities(world, [Position, Velocity]);             // has both
collectEntities(world, [Position, Velocity, not(Dead)]);  // and not Dead
collectEntities(world, [Position, or(Bullet, Asteroid)]); // and at least one of these
collectEntities(world, [pair(ChildOf, ship)]);            // children of ship
collectEntities(world, [Sprite, changed(Health)]);        // Health written since last run
```

- The results are typed with the required components, so reads on them return
  values without checks. Components inside `or` are not narrowed; check them
  with `hasComponent` before reading.
- A query needs at least one required component. `[not(Dead)]` alone throws
  `IrisInvalidQuery`.
- Run the query inside the system every time. Iris caches the matching work, so
  there is no reason to keep results between frames.
- Do not depend on the order of results. Use `queryFirstEntity` when you
  expect exactly one match.
- A tag in the query is the cheapest filter. Entities without it are never
  visited, so a `Stunned` tag beats checking a field on every entity.

---

## Reading and writing data

| Need | Read | Write | Cost |
|---|---|---|---|
| Whole record | `getComponent` (a copy) | `setComponent` (every field) | Allocates an object per call |
| One field (default) | `getComponentValue` | `setComponentValue` | Nothing for scalars, a small tuple for vectors |
| Hot loop over a vector field | `getComponentView` | write into the view, then `markComponentChanged` | Nothing |

Resources mirror these: `getResource`, `getResourceValue`, `getResourceView`,
`setResource`, `setResourceValue`, `markResourceChanged`.

A view is a live slice of a typed array:

```ts
export const integrateVelocity = defineSystem("integrateVelocity", (world) => {
  assertResource(world, Time);

  const delta = getResourceValue(world, Time, "delta");

  for (const entity of collectEntities(world, [Position, Velocity])) {
    const position = getComponentView(world, entity, Position, "value");
    const velocity = getComponentView(world, entity, Velocity, "value");

    position[0] += velocity[0] * delta;
    position[1] += velocity[1] * delta;

    // Writes through a view are invisible to changed() until marked
    markComponentChanged(world, entity, Position);
  }
});
```

Views exist only for vector fields. A view is valid until the next structural
change, so take it, use it in the loop body, and let it go.

Writes to a component the entity lacks do nothing, and reads return
`undefined`. Writing a value marks a change even if the value is equal, so
compare first when other systems react to `changed`.

---

## Structural changes

Creating and destroying entities, and adding and removing components, are
structural changes. They apply immediately; there is no command buffer.

- They are safe inside a `for...of` over `collectEntities`, because the array is
  a snapshot. Entities you add do not appear in it.
- They are not allowed inside an `EXPERIMENTAL_queryEntities` or
  `EXPERIMENTAL_queryColumns` callback, which walk live storage.
- They cost more than writing a field, because the entity's data moves to
  another archetype. Whether that matters depends on how many entities change
  and how much room the frame has. Measure before replacing them with fields.
- A destroy can cascade through `onDeleteTarget: "delete"` relations, so an
  entity later in your snapshot may already be gone. Check `isEntityAlive` when
  that can happen.

---

## Events

`emitEvent` works anywhere: in systems, in DOM handlers, in setup code. Reading
works only inside a running system, and each system has its own read position,
so every reader sees every event.

| Function | Use when |
|---|---|
| `readEvents(world, E, (data) => ...)` | Handle each unread event |
| `collectEvents(world, E)` | You need the whole batch as an array |
| `readLastEvent(world, E)` | Only the newest matters, e.g. a resize; the rest are marked read |
| `hasEvents(world, E)`, `countEvents(world, E)` | Peek without marking anything read |
| `clearEvents(world, E)` | Mark this system's unread events read, e.g. while paused |

```ts
export const updateViewport = defineSystem("updateViewport", (world) => {
  if (!hasEvents(world, ViewportResized)) {
    return;
  }

  // hasEvents narrowed the event, so this is not undefined
  const latest = readLastEvent(world, ViewportResized);

  setResource(world, Viewport, {
    width: latest.width,
    height: latest.height,
  });
});
```

Every read function consumes the whole unread window up front, even if the
callback stops early. `clearEvents` affects only the calling system; other
systems still see the events.

An event lives for the rest of the frame it was emitted in and all of the next
frame. A reader that runs after the emitter sees it the same frame; one that
runs earlier sees it next frame. A system that skips frames, through a
condition such as `every(2)`, can miss events.

Event payloads with entity IDs may point at entities destroyed since. Check
`isEntityAlive` before using them.

---

## Change detection

| Term | Matches |
|---|---|
| `added(C)` in a query | Entities that gained `C` since this system last ran |
| `changed(C)` in a query | Entities where `C` was added or written since this system last ran |
| `removed(C)`, an event read with `readEvents` | `{ entity }` for each entity that lost `C`, including by destruction |

`added` and `removed` together follow a component's whole life, which is how a
system keeps something outside the world in step with it:

```ts
// render/systems/sync-meshes.ts
export const syncMeshes = defineSystem("syncMeshes", (world) => {
  assertResource(world, Meshes);

  const meshes = getResourceValue(world, Meshes, "byEntity");

  // Removals first: a Model removed and added again this frame must end up
  // with a new mesh, not a disposed one
  readEvents(world, removed(Model), ({ entity }) => {
    // The entity may already be destroyed, but its ID still keys the map
    meshes.get(entity)?.dispose();
    meshes.delete(entity);
  });

  // Runs once per entity, when the Model appears
  for (const entity of collectEntities(world, [Model, added(Model)])) {
    meshes.set(entity, loadMesh(getComponentValue(world, entity, Model, "url")));
  }
});
```

The full recipe, with its pitfalls, is "Objects outside the world" in
`references/patterns.md`.

How the window works:

- Tracking is per system and per query. Two systems each see the same change.
- A system's first run sees every existing component as added and changed.
- Each read consumes the window. Running the same `added` or `changed` query
  twice in one system returns nothing the second time.
- A system sees its own writes made after its read on its next run. A system
  that reads `changed(C)` and writes `C` sees its own change next frame, so
  guard against feedback loops.
- Outside a running system, including in conditions, `added` and `changed`
  match nothing.

Order a detector after the systems that write what it watches, or it reacts one
frame late.

---

## Actions

An action is a function shared by several systems, built per world with
`defineActions`:

```ts
// combat/actions.ts
export const combatActions = defineActions((world) => ({
  spawnBullet(x: number, y: number, speed: number, owner: EntityId) {
    return createEntity(world, [
      Bullet,
      [Position, { value: [x, y] }],
      [Velocity, { value: [0, -speed] }],
      [Lifetime, { remaining: 1.5 }],
      pair(FiredBy, owner),
    ]);
  },

  // Typed with what it reads, so callers pass query results and the body
  // needs no checks
  dealDamage(target: EntityWith<typeof Health>, amount: number): void {
    const current = getComponentValue(world, target, Health, "current");

    setComponentValue(world, target, Health, "current", current - amount);
  },
}));
```

A system takes the actions it needs among its inputs, as `handleFire` does
above. `combatActions(world)` builds the object once per world and returns the
same one afterwards, so calling it on every run is cheap. It also works from
setup code and tests.

- **Action or system?** A direct change that several places need is an action:
  spawning, a multi-step state change, a read that combines several components.
  "When X happens, do Y" is a system.
- **Keep side effects close.** Pure helpers and reads can be shared widely.
  Actions that create, destroy, or cascade should have few callers. When many
  systems need the same heavy effect, emit a request event and let one system
  apply it.
- **Type entity parameters with `EntityWith`.** A parameter typed
  `EntityWith<typeof Health>` moves the proof to the caller, where a query or
  `createEntity` already made it. `EntityWith<typeof A | typeof B>` means both.
  Two separate `hasComponent` checks do not combine into that type, but
  `assertComponents(world, entity, [A, B])` does.
- **Compose them.** One domain's spawn action can call another's and add to the
  result. Spawn actions return the narrowed entity, so their result goes
  straight into other actions. See "Shared spawn logic" in `references/patterns.md`.

---

## Performance

- `getComponentValue` and `setComponentValue` are the default. Use views for
  vector fields in loops over many entities.
- `getComponent` allocates an object on every call. Keep it out of hot loops.
- Structural changes on many entities every frame are the usual cost to
  measure first. A field may be cheaper than toggling a tag.
- Guards and tags skip work entirely, which beats making the work faster.
- `EXPERIMENTAL_queryColumns` hands over raw columns for the hottest loops. It
  is unstable, rejects `added` and `changed`, and forbids structural changes in
  its callback. Reach for it only after measuring.
