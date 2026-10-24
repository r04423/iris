# API index

Every export of `iris-ecs`, grouped by concept. Nothing else exists: if a
function is not listed here, do not call it. Full signatures, JSDoc, and an
example for each are in `node_modules/iris-ecs/dist/index.d.ts`.

## Contents

- World
- Definitions and schema
- Entities and names
- Components
- Resources
- Relations
- Queries and change detection
- Events
- Systems and scheduling
- Actions
- Observers
- Types
- Errors

---

## World

- `createWorld()` creates an isolated world.
- `resetWorld(world)` clears entities, resources, names, and events; definitions and systems stay, and `Startup` runs again. Throws while running.
- `getWorldInternals(world)` read-only internals, for tooling only.

## Definitions and schema

- `defineComponent(name)` defines a tag. `defineComponent(name, { schema })` defines a data component, also used for resources.
- `defineRelation(name, { schema?, exclusive?, onDeleteTarget?: "remove" | "delete" })`.
- `defineEvent(name)` or `defineEvent(name, { schema })`.
- `Type.f32(n?)`, `Type.f64(n?)`, `Type.i8(n?)`, `Type.i16(n?)`, `Type.i32(n?)`, `Type.u32<T>(n?)` numeric fields; `n` from 2 to 16 makes a vector. `Type.bool()`, `Type.string()`, `Type.ref<T>()`.
- Built-in IDs: `Wildcard` (query-only pair term), `Name`, `Exclusive`, `OnDeleteTarget`.

## Entities and names

- `createEntity(world, entries?)` entries are tags, pairs, or `[Component, data]`. The result is narrowed to them.
- `destroyEntity(world, entity)` removes the entity and its components; pairs targeting it are removed or cascade. Idempotent.
- `isEntityAlive(world, entity)` checks the generation, so reused IDs read as dead.
- `assertEntity(world, entity)` throws `IrisEntityNotFound` and narrows away `undefined`.
- `setName(world, entity, name)`, `getName(world, entity)`, `removeName(world, entity)`. Names are unique per world, stored in the `Name` component, and freed when the entity is destroyed.
- `lookupByName(world, name, components?)` returns the entity, narrowed to `components`, or `undefined`.

## Components

- `addComponent(world, entity, tagOrPair)` or `addComponent(world, entity, Component, data)`. Keeps existing values if present.
- `addComponents(world, entity, entries)` same entry list as `createEntity`.
- `removeComponent(world, entity, C)`, `removeComponents(world, entity, list)`. Idempotent.
- `hasComponent(world, entity, C)` type guard. `assertComponent`, `assertComponents` throw `IrisComponentNotFound` and narrow.
- `getComponent(world, entity, C)` record copy. `setComponent(world, entity, C, record)` replaces every field.
- `getComponentValue(world, entity, C, field)`, `setComponentValue(world, entity, C, field, value)`. Vectors read and write as tuples.
- `getComponentView(world, entity, C, vectorField)` live typed-array slice; valid until the next structural change.
- `markComponentChanged(world, entity, C)` after writing through a view.

## Resources

- `addResource(world, C, data)` stores one per world. `C` needs a schema; tags are rejected by the types. Idempotent; never overwrites.
- `removeResource(world, C)`, `hasResource(world, C)` (narrows), `assertResource(world, C)` (throws `IrisResourceNotFound`, narrows).
- `getResource`, `setResource`, `getResourceValue`, `setResourceValue`, `getResourceView`, `markResourceChanged`, mirroring the component accessors. Value reads return `undefined` unless narrowed.

## Relations

- `pair(Relation, target)` builds the pair ID used as a component or query term.
- `getRelationTargets(world, entity, Relation)` returns the targets the entity holds.
- `getPairTarget(world, pairId)`, `getPairRelation(pairId)`, `isPair(id)`.

## Queries and change detection

- `collectEntities(world, terms)` snapshot array, narrowed to required components.
- `queryFirstEntity(world, terms)` first match or `undefined`.
- Terms: a component, tag, or pair; `not(C)`; `or(A, B, ...)` (not narrowed); `added(C)`; `changed(C)`.
- `removed(C)` returns an event with `{ entity }`, read with `readEvents`.
- `EXPERIMENTAL_queryEntities(world, terms, callback)` live iteration; no structural changes inside. Unstable.
- `EXPERIMENTAL_queryColumns(world, terms, callback)` raw columns; no `added`/`changed`, no structural changes. Unstable.

## Events

- `emitEvent(world, Event, data?)` from anywhere.
- Inside systems only: `readEvents(world, Event, callback)`, `collectEvents(world, Event)`, `readLastEvent(world, Event)`, `clearEvents(world, Event)`.
- Peek without consuming: `hasEvents(world, Event)` (narrows for `readLastEvent`), `countEvents(world, Event)`.

## Systems and scheduling

- `defineSystem(name, (world) => void | Promise<void>)`.
- `addSystem(world, system, { schedule?, set?, before?, after?, name?, condition? })`, `addSystems(world, systems, options)`.
- `defineSystemSet(name)`, `addSystemSet(world, set, { schedule?, before?, after?, condition? })`.
- Schedules: `Startup`, `First`, `PreUpdate`, `Update` (default), `PostUpdate`, `Last`, `Shutdown`. `defineSchedule(name)`, `insertScheduleBefore(world, schedule, anchor)`, `insertScheduleAfter(world, schedule, anchor)`.
- Conditions: `defineCondition(name, (world) => boolean)`, `once()`, `every(n)`. Each call makes a new condition. `condition.check(world)` is public, for composing conditions.
- Running: `run(world, driver?)`, `runOnce(world)`, `suspend(world)`, `stop(world)`. Drivers: `animationFrameDriver` (default), `createTimeoutDriver(ms)`.

## Actions

- `defineActions((world) => ({ ...methods }))` returns a getter; `getter(world)` builds the object once per world.

## Observers

- `registerObserverCallback(world, event, callback)`, `unregisterObserverCallback(world, event, callback)`. Synchronous engine hooks for tooling, such as profilers and debug views, not game logic. Events include `entityCreated`, `entityDestroyed`, `componentAdded`, `componentRemoved`, `componentChanged`, `worldReset`, `systemFinished`, `frameFailed`.

## Types

`World`, `Entity`, `EntityId` (any ID), `EntityWith<C>` (an ID known to have `C`), `Tag`, `Component`, `Relation`, `Pair`, `Event`, `System`, `Condition`, `ScheduleLabel`, `SystemSetLabel`, `FrameDriver`, `QueryTerm`, `QueryTerms`, `Observer`, `InferSchema`, `InferSchemaRecord`, `ScalarFields`, `VectorFields`.

Type action and helper parameters as `EntityWith<typeof Position>`, or
`EntityWith<typeof A | typeof B>` for both, when they read those components.
Queries, `createEntity`, `addComponents`, `lookupByName`, `hasComponent`, and
`assertComponent(s)` produce that type.

## Errors

Every error extends `IrisError` and one category: `IrisNotFound`,
`IrisDuplicate`, `IrisInvalidArgument`, `IrisInvalidState`, `IrisLimitExceeded`.
Specific classes include `IrisEntityNotFound`, `IrisComponentNotFound`,
`IrisResourceNotFound`, `IrisDuplicateDefinition`, `IrisDuplicateName`,
`IrisDuplicateSystem`, `IrisInvalidPair`, `IrisInvalidQuery`,
`IrisSystemNotFound`, `IrisCircularDependency`, and `IrisSchedulerBusy`.
