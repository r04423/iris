# Testing

Small, stateless systems are easy to test: build a world, run a frame, check
the data. Examples use `node:test`; use the project's runner, file layout, and
naming conventions if it has them.

## Contents

- Testing a system
- A test world built from real systems
- Events in tests
- Change detection in tests
- Testing actions
- Errors
- What every test must respect

---

## Testing a system

Arrange the entities and resources, register the system under test, run one
frame, and assert on the data:

```ts
// combat/systems/apply-hits.test.ts
import assert from "node:assert";
import { test } from "node:test";
import {
  addSystem,
  createEntity,
  createWorld,
  getComponentValue,
  hasComponent,
  runOnce,
} from "iris-ecs";
import { Health, Hit, Shield } from "../components.js";
import { applyHits } from "./apply-hits.js";

test("applyHits takes damage from health when there is no shield", async () => {
  const world = createWorld();
  const ship = createEntity(world, [
    [Hit, { damage: 10 }],
    [Health, { current: 100, max: 100 }],
  ]);

  addSystem(world, applyHits);
  await runOnce(world);

  assert.strictEqual(getComponentValue(world, ship, Health, "current"), 90);
  assert.strictEqual(hasComponent(world, ship, Hit), false);
});

test("applyHits drains the shield before health", async () => {
  const world = createWorld();
  const ship = createEntity(world, [
    [Hit, { damage: 10 }],
    [Health, { current: 100, max: 100 }],
    [Shield, { strength: 50 }],
  ]);

  addSystem(world, applyHits);
  await runOnce(world);

  assert.strictEqual(getComponentValue(world, ship, Shield, "strength"), 40);
  assert.strictEqual(getComponentValue(world, ship, Health, "current"), 100);
});
```

`addResource` works outside systems, so add the resources the system asserts
in the arrange step.

---

## A test world built from real systems

When a system depends on data that other systems produce, register those
systems instead of rebuilding their output by hand. The test feeds inputs and
checks outcomes, and it keeps passing when the upstream data changes shape.

If the app registers systems per domain (see "Assembling the frame" in
`references/architecture.md`), a test world calls the same functions, so every
system runs in its real schedule and order:

```ts
// test-world.ts
import type { World } from "iris-ecs";
import { addResource, createWorld } from "iris-ecs";

export function createTestWorld(): World {
  const world = createWorld();

  // addResource never overwrites, so the app's own Startup keeps this fake
  addResource(world, Services, {
    platform: createFakePlatform(),
  });

  registerTime(world);
  registerInput(world);
  registerCombat(world);

  return world;
}

// combat/systems/handle-fire.test.ts
test("a fire request spawns a bullet", async () => {
  const world = createTestWorld();

  // The first frame runs Startup, which adds resources and spawns the ship
  await runOnce(world);

  emitEvent(world, FireRequested);
  await runOnce(world);

  assert.strictEqual(collectEntities(world, [Bullet]).length, 1);
});
```

Startup runs inside the first `runOnce`, so resources and entities it creates
do not exist before then. Run one frame first when the arrange step needs
them, or arrange through events the real systems consume.

A test world can also take the systems under test as a parameter and register
only the upstream systems they need. Each extra system is one more thing that
can fail for an unrelated reason, so register what the behavior needs. Run as
many frames as the chain needs: damage, then death, then cleanup may take one
`runOnce` each. Services injected this way, such as a fake clock, make time
and randomness predictable. See "Injected services" in
`references/patterns.md`.

---

## Events in tests

Events emitted before `runOnce` are delivered to systems in that frame:

```ts
test("handleFire spawns a bullet per request", async () => {
  const world = createWorld();

  addResource(world, CombatConfig, {
    shootCooldown: 0.08,
    bulletSpeed: 520,
  });
  createEntity(world, [
    Ship,
    [Position, { value: [400, 300] }],
  ]);
  emitEvent(world, FireRequested);
  emitEvent(world, FireRequested);

  addSystem(world, handleFire);
  await runOnce(world);

  assert.strictEqual(collectEntities(world, [Bullet]).length, 2);
});
```

Reading events only works in a system, so to check what a system emits,
register a small probe system after it:

```ts
const killed: EntityId[] = [];

const recordKills = defineSystem("recordKills", (world) => {
  readEvents(world, EnemyKilled, ({ enemy }) => {
    killed.push(enemy);
  });
});

addSystem(world, detectKills);
addSystem(world, recordKills, { after: [detectKills] });
await runOnce(world);

assert.strictEqual(killed.length, 1);
```

---

## Change detection in tests

A system's first run sees everything as added and changed. To test that a system
reacts to a change, run one frame to settle, make the change, then run again:

```ts
// flashOnDamage adds the Flash tag to every entity in [Health, changed(Health)]
test("flashOnDamage flashes only entities whose health changed", async () => {
  const world = createWorld();
  const hurt = createEntity(world, [[Health, { current: 100, max: 100 }]]);
  const fine = createEntity(world, [[Health, { current: 100, max: 100 }]]);

  addSystem(world, flashOnDamage);

  // The first run sees every Health as changed
  await runOnce(world);

  removeComponent(world, hurt, Flash);
  removeComponent(world, fine, Flash);
  setComponentValue(world, hurt, Health, "current", 50);
  await runOnce(world);

  assert.strictEqual(hasComponent(world, hurt, Flash), true);
  assert.strictEqual(hasComponent(world, fine, Flash), false);
});
```

Writes made from the test between frames count as changes for the next frame.

---

## Testing actions

Actions work outside systems, so call them directly:

```ts
test("spawnBullet creates a bullet fired by its owner", () => {
  const world = createWorld();
  const ship = createEntity(world, [Ship]);

  const bullet = combatActions(world).spawnBullet(10, 20, 520, ship);

  assert.deepStrictEqual(getComponentValue(world, bullet, Position, "value"), [10, 20]);
  assert.strictEqual(hasComponent(world, bullet, pair(FiredBy, ship)), true);
});
```

---

## Errors

Assert the specific error class from `iris-ecs`, not just that something threw:

```ts
test("dealDamage rejects a destroyed target", () => {
  const world = createWorld();
  const ship = createEntity(world, [[Health, { current: 100, max: 100 }]]);

  destroyEntity(world, ship);

  assert.throws(() => combatActions(world).dealDamage(ship, 10), IrisEntityNotFound);
});
```

---

## What every test must respect

- **A new world per test.** Worlds share nothing except definitions, so a fresh
  `createWorld()` is a clean slate. No reset or teardown is needed.
- **Import definitions from the domain**; do not redefine them in tests.
  Definitions are global to the process, and a second `defineComponent` with
  the same name throws `IrisDuplicateDefinition`. Definitions made only for a
  test need names no other module uses.
- **Step frames with `runOnce`**, not `run`, so there are no timers to wait
  for. `runOnce` throws `IrisSchedulerBusy` while `run` is active.
- **Change detection and event reads need a running system.** Assert their
  effects on data, or through a probe system.
- **Worth covering in ECS code:** destroyed and reused entity IDs, empty
  queries, a missing optional resource, events arriving in the frame after
  they were emitted, and ordering between the systems under test.
