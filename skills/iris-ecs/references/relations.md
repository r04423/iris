# Relations

Relations connect one entity to another: a turret mounted on a ship, a bullet
fired by a player, an enemy chasing a target. A relation combined with a target
is a **pair**, and a pair works anywhere a component works. Because tags and
components are entities too, a pair can also point at a definition, which turns
relations into enums, per-key data, and more.

## Contents

- Defining and adding pairs
- Querying pairs
- From an entity to its targets
- Exclusive relations
- One state out of several
- Relations with data
- Pairs that point at definitions
- When the target is destroyed
- Hierarchies
- Change detection on pairs
- Choosing the direction
- Limits and costs

---

## Defining and adding pairs

```ts
// relations.ts
import { defineRelation } from "iris-ecs";

// A child has one parent and dies with it
export const ChildOf = defineRelation("ChildOf", {
  exclusive: true,
  onDeleteTarget: "delete",
});

// Kept for scoring after the shooter dies
export const FiredBy = defineRelation("FiredBy");
```

```ts
// On creation, a pair goes in the entry list like a tag
const turret = createEntity(world, [
  Turret,
  [Position, { value: [0, 0] }],
  pair(ChildOf, ship),
]);

// Or added later
addComponent(world, bullet, pair(FiredBy, player));
```

`pair(ChildOf, ship)` allocates nothing and always gives the same ID for the same
inputs, so it is cheap to build inside a loop.

---

## Querying pairs

A concrete pair in a query finds the holders for one target:

```ts
// Every child of this ship that has a Position
collectEntities(world, [pair(ChildOf, ship), Position]);
```

`Wildcard` matches any target, or any relation:

```ts
// Everything that has a parent
collectEntities(world, [pair(ChildOf, Wildcard)]);

// Everything pointing at the ship, by any relation
collectEntities(world, [pair(Wildcard, ship)]);

// Roots: entities with no parent
collectEntities(world, [Transform, not(pair(ChildOf, Wildcard))]);
```

An entity with several targets appears once in a Wildcard query.
`hasComponent(world, entity, pair(MemberOf, Wildcard))` asks "has any".

---

## From an entity to its targets

`getRelationTargets` returns the targets an entity holds for one relation, as a
new array:

```ts
const [parent] = getRelationTargets(world, turret, ChildOf);
```

When a query hands back a pair ID you did not build, `getPairTarget(world, pairId)`
and `getPairRelation(pairId)` take it apart. Check `isPair(id)` first if the ID
might be a plain component.

Adding or removing a pair with `Wildcard` throws `IrisInvalidPair`, so clearing
a relation means removing each concrete pair:

```ts
for (const squad of getRelationTargets(world, scout, MemberOf)) {
  removeComponent(world, scout, pair(MemberOf, squad));
}
```

---

## Exclusive relations

With `exclusive: true`, an entity holds at most one target for the relation.
Adding a new pair replaces the old one in a single move, so retargeting or
moving is one call:

```ts
export const Targeting = defineRelation("Targeting", { exclusive: true });

// Replaces any earlier target
addComponent(world, enemy, pair(Targeting, player));

// Moving every item from the chest to the backpack
for (const item of collectEntities(world, [Item, pair(ContainedBy, chest)])) {
  addComponent(world, item, pair(ContainedBy, backpack));
}
```

Without `exclusive`, an entity can hold many pairs of the same relation. Leave
it off when one entity relates to several targets at once, e.g. a `MemberOf`
relation for a unit in several squads.

---

## One state out of several

An exclusive relation whose targets are tags is an enum: the relation is the
type, and each tag is one value. Switching state is one call, queries filter on
a value or on any value, and change detection reports entering and leaving:

```ts
// movement/relations.ts
export const Movement = defineRelation("Movement", { exclusive: true });

export const Idle = defineComponent("Idle");
export const Walking = defineComponent("Walking");
export const Running = defineComponent("Running");
```

```ts
// Replaces whichever state the hero had
addComponent(world, hero, pair(Movement, Running));

// Only the runners
collectEntities(world, [Position, pair(Movement, Running)]);

// Everyone with a state, except the idle
collectEntities(world, [pair(Movement, Wildcard), not(pair(Movement, Idle))]);

// The current value, comparable with === or in a switch
const [state] = getRelationTargets(world, hero, Movement);
```

```ts
// movement/systems/start-running.ts
export const startRunning = defineSystem("startRunning", (world) => {
  // Entering a state: the pair was added
  for (const entity of collectEntities(world, [Dust, added(pair(Movement, Running))])) {
    setComponentValue(world, entity, Dust, "rate", 30);
  }

  // Leaving a state: the replaced pair reports as removed
  readEvents(world, removed(pair(Movement, Running)), ({ entity }) => {
    if (isEntityAlive(world, entity) && hasComponent(world, entity, Dust)) {
      setComponentValue(world, entity, Dust, "rate", 0);
    }
  });
});
```

- `added` sees the state at the time the system runs. A state entered and left
  between two runs is never seen; emit an event when every transition matters.
- Each switch moves the entity to another archetype. For states that flip
  every frame on many entities, a field such as `Type.string<"idle" | "run">()`
  costs less, at the price of filtering in the loop.
- A resource or a tag definition can hold the same kind of pair for state that
  belongs to the whole app. See "App states" in `references/patterns.md`.

---

## Relations with data

A relation with a schema stores values on each pair, for facts that belong to
the link rather than to either side:

```ts
export const Orbiting = defineRelation("Orbiting", {
  schema: {
    // Pixels from the target's center
    radius: Type.f32(),
    // Radians per second
    speed: Type.f32(),
  },
  exclusive: true,
  onDeleteTarget: "delete",
});

const drone = createEntity(world, [
  [Position, { value: [0, 0] }],
  [pair(Orbiting, ship), { radius: 40, speed: 2 }],
]);
```

Read and write pair data with the usual accessors, using the concrete pair:

```ts
const [target] = getRelationTargets(world, drone, Orbiting);

assertEntity(world, target);

const link = pair(Orbiting, target);

// Narrows drone, so the read returns a number, not undefined
assertComponent(world, drone, link);

const radius = getComponentValue(world, drone, link, "radius");
```

Two drones on one ship can orbit at different radii, because each pair holds
its own values.

---

## Pairs that point at definitions

A target can be any entity, including a tag or a component. One relation with
data then holds a value per key, like a map on the entity that queries can see:

```ts
export const Cooldown = defineRelation("Cooldown", {
  schema: {
    // Seconds until the ability is ready again
    remaining: Type.f32(),
  },
});

export const Fire = defineComponent("Fire");
export const Dash = defineComponent("Dash");

const ship = createEntity(world, [
  [pair(Cooldown, Fire), { remaining: 0.2 }],
  [pair(Cooldown, Dash), { remaining: 1.5 }],
]);
```

```ts
// abilities/systems/tick-cooldowns.ts
export const tickCooldowns = defineSystem("tickCooldowns", (world) => {
  assertResource(world, Time);

  const delta = getResourceValue(world, Time, "delta");

  for (const entity of collectEntities(world, [pair(Cooldown, Wildcard)])) {
    for (const ability of getRelationTargets(world, entity, Cooldown)) {
      const key = pair(Cooldown, ability);

      assertComponent(world, entity, key);

      const remaining = getComponentValue(world, entity, key, "remaining") - delta;

      // No pair means ready, so there is no ready flag to keep in sync
      if (remaining <= 0) {
        removeComponent(world, entity, key);

        continue;
      }

      setComponentValue(world, entity, key, "remaining", remaining);
    }
  }
});
```

The same shape gives timed components: `pair(Expires, Shielded)` with a
`remaining` field, and one system that removes both `Shielded` and the pair when
time runs out. That system works for any component used as a target.

A definition can also carry data of its own, e.g.
`addComponent(world, Running, Speed, { value: 6 })` gives each state its speed.
`collectEntities(world, [Speed])` then returns the definitions too, so use a
component that gameplay entities never have. Data on definitions is cleared by
`resetWorld`, so add it from a `Startup` system.

---

## When the target is destroyed

Destroying an entity always removes every pair that targets it, so a pair never
points at a reused ID. `onDeleteTarget` decides what happens to the holder:

- `"remove"` (default): the pair is dropped and the holder lives on. An enemy
  keeps flying when the player it chased dies.
- `"delete"`: the holder is destroyed too, and this cascades down a tree. A
  turret dies with its ship, and the turret's own children die with it.

`"delete"` makes cleanup free in several shapes:

- **Scenes and levels.** Make every entity of a level a child of a level root.
  Destroying the root unloads the level.
- **Requests that cancel themselves.** A pending order entity that points at
  its target with `onDeleteTarget: "delete"` disappears when the target dies,
  with no check in the system that carries it out.
- **Containment.** Items in a chest die with the chest.

Cascades can destroy entities that are still in a snapshot you are iterating.
Check `isEntityAlive` before touching an entity after you destroyed something
with `"delete"` children.

---

## Hierarchies

Iris has no query that walks a hierarchy for you. To visit parents before their
children, start from the roots and recurse:

```ts
// transform/systems/follow-parents.ts
// Typed with what it reads: callers pass query results, and the read below
// needs no check
function placeChildren(world: World, parent: EntityWith<typeof Position>): void {
  const [px, py] = getComponentValue(world, parent, Position, "value");

  for (const child of collectEntities(world, [pair(ChildOf, parent), Position, Offset])) {
    const [ox, oy] = getComponentValue(world, child, Offset, "value");

    setComponentValue(world, child, Position, "value", [px + ox, py + oy]);
    placeChildren(world, child);
  }
}

export const followParents = defineSystem("followParents", (world) => {
  for (const root of collectEntities(world, [Position, not(pair(ChildOf, Wildcard))])) {
    placeChildren(world, root);
  }
});
```

---

## Change detection on pairs

Use concrete pairs with `added`, `changed`, and `removed`:
`added(pair(Movement, Running))`, `removed(pair(Movement, Idle))`. A Wildcard
pair in a change term does not follow each concrete pair; for example,
`added(pair(Movement, Wildcard))` fires only when the first `Movement` pair
arrives, not when an exclusive pair is replaced.

---

## Choosing the direction

Store the pair on the entity that has one target, pointing at the entity that
may have many: the child points at its parent, the bullet at its shooter, each
enemy at its target. Then queries go the other way with `pair(Relation, target)`.
Query the children instead of also keeping a list on the parent.

---

## Limits and costs

- A program can define at most 256 relations, `Wildcard` included. Define
  relations at module scope, never per entity or per level.
- Each distinct target adds a few archetypes, freed when the target dies. That
  is fine for hierarchies, ownership, states, and hundreds of cells or groups.
  For a value that is just a number, use a field.
- A query with a concrete pair, such as `pair(ChildOf, parent)`, is cached per
  target until `resetWorld`. To visit every parent's children in one pass, query
  `pair(ChildOf, Wildcard)` and read targets with `getRelationTargets`.
- `getRelationTargets` allocates an array per call. In a hot loop over many
  entities with exclusive relations, prefer queries on concrete pairs.
- `resetWorld` clears pairs and data on definitions along with everything else.
