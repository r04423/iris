# Data modeling

Design the data before any system. Like a database schema, the shape of the
data decides how simple the systems can be, and it is the hardest part to
change later.

## Contents

- Start from the questions
- Components and field types
- Tags
- How big a component should be
- Collections as entities
- Resources
- Events
- Entity references, names, and outside IDs
- Checklist

---

## Start from the questions

List the state the feature needs, then answer for each piece:

- **How many?** One per world is a resource. One per entity is a component.
  Many per entity are usually child entities linked by a relation. "Only
  sometimes" is a component that is added and removed, or a tag. One state out
  of several is an exclusive relation (see `references/relations.md`).
- **Who writes it, and who reads it?** Fields written by different systems, or
  at different rates, belong in different components.
- **How often does it change?** Writing a field is the cheapest change. Adding
  or removing a component or tag moves the entity's data, which costs more.
- **Does it outlive the frame?** If not, it is an event, not stored state.
- **Does it live outside the world?** Textures, meshes, DOM nodes, and physics
  bodies can sit in a component field, or in a registry resource keyed by
  entity. See "Objects outside the world" in `references/patterns.md`.

Then group fields by how they are used. Fields that are always read and written
together form one component.

---

## Components and field types

```ts
import { defineComponent, Type } from "iris-ecs";

export const Position = defineComponent("Position", {
  schema: {
    value: Type.f32(2),
  },
});

export const Health = defineComponent("Health", {
  schema: {
    current: Type.i32(),
    max: Type.i32(),
  },
});

export const Sprite = defineComponent("Sprite", {
  schema: {
    // The image is shared, so many sprites can point at one object
    texture: Type.ref<HTMLImageElement>(),
    // RGBA, 0 to 255
    tint: Type.u32(4),
  },
});
```

| Factory | Storage | Use for |
|---|---|---|
| `Type.f32()` | `Float32Array` | Positions, velocities, most numbers |
| `Type.f64()` | `Float64Array` | Timestamps, totals that grow, anything needing precision |
| `Type.i8()`, `Type.i16()`, `Type.i32()` | Signed int arrays | Counts, health, scores |
| `Type.u32()` | `Uint32Array` | Flags, colors, entity IDs |
| `Type.bool()` | Plain array | Flags |
| `Type.string()` | Plain array | Text |
| `Type.ref<T>()` | Plain array | Objects that cannot be split into numbers |

There are no `u8` or `u16` types. Passing a size from 2 to 16 to a numeric
factory makes a vector field: `Type.f32(2)` holds `[x, y]` as two consecutive
floats, read and written as a tuple.

Prefer numeric fields. They live in typed arrays, so iterating many entities
stays cheap and allocation free. Use a vector when the numbers always travel
together (a position, a color), and separate scalar fields when they change
independently. `Type.ref` is for things that are objects by nature: textures,
DOM nodes, sets, and services.

Comment a field when its unit or range is not obvious from the name.

---

## Tags

A component without a schema is a tag. It stores nothing and marks membership:

```ts
export const Asteroid = defineComponent("Asteroid");
export const Stunned = defineComponent("Stunned");
```

Tags work for kinds (`Asteroid`, `Bullet`, `Player`) and for states
(`Stunned`, `Selected`). Queries filter on them like an index, so a system that
handles only stunned entities never visits the others.

Adding or removing a tag moves the entity's data to another archetype. Toggling
a tag every frame is fine when the entities are few or the frame has room. When
thousands of entities flip state every frame, measure, and consider a field
such as `Cooldown { remaining }` that systems check instead.

---

## How big a component should be

- **One concern per component.** `Health { current, max }` and
  `Shield { strength }`, not `Combatant { health, maxHealth, shield, damage, team }`.
  A system asks for exactly the data it uses, and a change to one component
  touches fewer systems.
- **Optional abilities are separate components.** An entity has a shield or it
  does not. Presence is the flag, so there is no `hasShield` field.
- **Do not split what is always used together.** A cooldown's `remaining` and
  `duration` are read together every time, so they share one component.
- **Data, not behavior.** Logic goes in systems and actions. The exception is a
  service the application injects, such as a platform adapter or a random
  source, which lives in a resource. See "Injected services" in
  `references/patterns.md`.

---

## Collections as entities

When an entity owns many of something, prefer making each one an entity linked
by a relation over storing an array:

```ts
export const ChildOf = defineRelation("ChildOf", {
  exclusive: true,
  onDeleteTarget: "delete",
});

const turret = createEntity(world, [
  Turret,
  [Position, { value: [0, 0] }],
  pair(ChildOf, ship),
]);

const turrets = collectEntities(world, [Turret, pair(ChildOf, ship)]);
```

Child entities can be queried, can carry their own components, take part in
change detection, and are cleaned up with the parent when the relation says
`onDeleteTarget: "delete"`. Query for `pair(ChildOf, parent)` instead of
keeping a list of children on the parent, so there is no second list to keep
in sync.

An array field is still the simpler choice for values that are read as a
whole and never queried one by one, such as the points of a path, or data an
outside library owns. Use `Type.ref<T[]>()` there. See
`references/relations.md` for the relation API.

---

## Resources

A resource is data that belongs to the world, with exactly one per world: the
clock, the score, configuration, input state, a spatial index.

```ts
// combat/resources.ts
export const CombatConfig = defineComponent("CombatConfig", {
  schema: {
    // Seconds between shots
    shootCooldown: Type.f32(),
    // Pixels per second
    bulletSpeed: Type.f32(),
  },
});

// combat/systems/init-combat.ts, registered in Startup
export const initCombat = defineSystem("initCombat", (world) => {
  addResource(world, CombatConfig, {
    shootCooldown: 0.08,
    bulletSpeed: 520,
  });
});
```

Each domain adds its own resources from a `Startup` system. Keep shared state in
resources, never in module-level variables or inside systems, so every world,
test, and reset starts clean.

A resource is defined like a component, and its data is stored on the
definition's own ID. So `collectEntities(world, [CombatConfig])` returns that
one ID, and putting the same component on entities mixes them into the result.
Use a component either as a resource or on entities, not both.

---

## Events

An event is a fact or a request that nobody needs after the next frame: a key
was pressed, a bullet hit, a level should load.

```ts
export const FireRequested = defineEvent("FireRequested");

export const Collision = defineEvent("Collision", {
  schema: {
    bullet: Type.u32<EntityId>(),
    asteroid: Type.u32<EntityId>(),
  },
});
```

Choose an event when something happened once. Choose a component or resource
when the state must persist, or when the reader might not run every frame.
Event names are global to the process, like component names.

---

## Entity references, names, and outside IDs

To point at another entity, prefer a relation. When the target is destroyed, the
pair is removed or the holder is destroyed, so the reference never dangles. A
`Type.u32<EntityId>()` field also works, but nothing updates it. Check
`isEntityAlive` before using it, because IDs are reused. Never store an entity
ID in a float field.

Any entity with an identity of its own can have a name: the player, the camera,
a level root, or each record mirrored from outside:

```ts
setName(world, ship, "player");

// Undefined unless the entity has Health, and narrowed to it when found
const player = lookupByName(world, "player", [Health]);
```

Names are unique within a world, and Iris keeps the index: destroying an entity
frees its name, so a lookup never returns a dead entity. Passing the expected
components makes the lookup return `undefined` unless all are present, and
narrows the result. Use tags, not names, for groups of entities.

Entities that mirror outside records, such as rows from a server, a document
model, or an editor's scene, can use the outside ID as their name, with a
prefix per kind such as `todo:42`, because all names share one namespace. Each
update then finds its entity with `lookupByName`, and a query on `Name` finds
the entities whose records disappeared. See "Syncing outside data" in
`references/patterns.md`.

---

## Checklist

- [ ] Every piece of state has one home: component, tag, resource, relation, or
      event.
- [ ] Components are small and data only, grouped by who writes them.
- [ ] Numeric fields use typed `Type` factories; `Type.ref` holds objects.
- [ ] Structural changes on many entities every frame are measured, not
      assumed cheap.
- [ ] Collections are child entities with a relation, unless they are plain
      values read as a whole.
- [ ] Shared state is a resource added in `Startup`, not a module variable.
- [ ] Every definition is at module scope with a unique name.
