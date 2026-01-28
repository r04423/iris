import assert from "node:assert";
import { describe, it } from "node:test";
import { defineActions } from "./actions.js";
import { addComponent, getComponentValue, hasComponent } from "./component.js";
import type { Entity } from "./encoding.js";
import { createEntity } from "./entity.js";
import { defineComponent } from "./registry.js";
import { Type } from "./schema.js";
import { createWorld } from "./world.js";

// ============================================================================
// Test Components
// ============================================================================

const Position = defineComponent("Position", {
  x: Type.f32(),
  y: Type.f32(),
});

const Health = defineComponent("Health", {
  current: Type.i32(),
  max: Type.i32(),
});

// ============================================================================
// Actions Tests
// ============================================================================

describe("Actions", () => {
  // ============================================================================
  // Basic Definition Tests
  // ============================================================================

  describe("Basic Definition", () => {
    it("creates actions with world captured in closure", () => {
      const testActions = defineActions((world) => ({
        getEntityCount(): number {
          return world.entities.byId.size;
        },
      }));

      const world = createWorld();
      const actions = testActions(world);

      // Initial count (includes internal entities from name/removal systems)
      const initialCount = actions.getEntityCount();

      createEntity(world);

      assert.strictEqual(actions.getEntityCount(), initialCount + 1);
    });

    it("actions can access world state without explicit parameter", () => {
      const testActions = defineActions((world) => ({
        createAndCount(): { entity: Entity; count: number } {
          const entity = createEntity(world);
          return { entity, count: world.entities.byId.size };
        },
      }));

      const world = createWorld();
      const actions = testActions(world);
      const result = actions.createAndCount();

      assert.strictEqual(typeof result.entity, "number");
      assert.ok(world.entities.byId.has(result.entity));
    });

    it("actions can call other ECS functions with captured world", () => {
      const testActions = defineActions((world) => ({
        spawnWithPosition(x: number, y: number): Entity {
          const entity = createEntity(world);
          addComponent(world, entity, Position, { x, y });
          return entity;
        },
      }));

      const world = createWorld();
      const actions = testActions(world);
      const entity = actions.spawnWithPosition(100, 200);

      assert.strictEqual(hasComponent(world, entity, Position), true);
      assert.strictEqual(getComponentValue(world, entity, Position, "x"), 100);
      assert.strictEqual(getComponentValue(world, entity, Position, "y"), 200);
    });
  });

  // ============================================================================
  // Caching Tests
  // ============================================================================

  describe("Caching", () => {
    it("same world returns identical actions object", () => {
      const testActions = defineActions((world) => ({
        noop(): void {
          void world;
        },
      }));

      const world = createWorld();

      const first = testActions(world);
      const second = testActions(world);
      const third = testActions(world);

      assert.strictEqual(first, second);
      assert.strictEqual(second, third);
    });

    it("initializer runs only once per world", () => {
      let initCount = 0;

      const testActions = defineActions((world) => {
        initCount++;
        return {
          check(): number {
            return world.execution.tick;
          },
        };
      });

      const world = createWorld();

      testActions(world);
      testActions(world);
      testActions(world);

      assert.strictEqual(initCount, 1);
    });

    it("actions cached in world.actions.byInitializer", () => {
      const testActions = defineActions((world) => ({
        getId(): number {
          return world.execution.tick;
        },
      }));

      const world = createWorld();

      assert.strictEqual(world.actions.byInitializer.size, 0);

      const actions = testActions(world);

      assert.strictEqual(world.actions.byInitializer.size, 1);
      assert.strictEqual(world.actions.byInitializer.values().next().value, actions);
    });
  });

  // ============================================================================
  // Cross-World Isolation Tests
  // ============================================================================

  describe("Cross-World Isolation", () => {
    it("different worlds get different actions objects", () => {
      const testActions = defineActions((world) => ({
        check(): number {
          return world.execution.tick;
        },
      }));

      const world1 = createWorld();
      const world2 = createWorld();

      const actions1 = testActions(world1);
      const actions2 = testActions(world2);

      assert.notStrictEqual(actions1, actions2);
    });

    it("actions on different worlds operate independently", () => {
      const testActions = defineActions((world) => ({
        createEntity(): Entity {
          return createEntity(world);
        },
        getCount(): number {
          return world.entities.byId.size;
        },
      }));

      const world1 = createWorld();
      const world2 = createWorld();

      const actions1 = testActions(world1);
      const actions2 = testActions(world2);

      const initialCount1 = actions1.getCount();
      const initialCount2 = actions2.getCount();

      // Create entities only in world1
      actions1.createEntity();
      actions1.createEntity();
      actions1.createEntity();

      assert.strictEqual(actions1.getCount(), initialCount1 + 3);
      assert.strictEqual(actions2.getCount(), initialCount2); // unchanged
    });

    it("initializer runs once per world", () => {
      let totalInits = 0;

      const testActions = defineActions((world) => {
        totalInits++;
        return {
          noop(): void {
            void world;
          },
        };
      });

      const world1 = createWorld();
      const world2 = createWorld();
      const world3 = createWorld();

      testActions(world1);
      testActions(world1);
      testActions(world2);
      testActions(world2);
      testActions(world3);

      assert.strictEqual(totalInits, 3);
    });
  });

  // ============================================================================
  // Multiple Action Definitions Tests
  // ============================================================================

  describe("Multiple Action Definitions", () => {
    it("multiple action definitions coexist on same world", () => {
      const transformActions = defineActions((world) => ({
        spawn(x: number, y: number): Entity {
          const entity = createEntity(world);
          addComponent(world, entity, Position, { x, y });
          return entity;
        },
      }));

      const healthActions = defineActions((world) => ({
        spawn(current: number, max: number): Entity {
          const entity = createEntity(world);
          addComponent(world, entity, Health, { current, max });
          return entity;
        },
      }));

      const world = createWorld();

      const transform = transformActions(world);
      const health = healthActions(world);

      const posEntity = transform.spawn(10, 20);
      const healthEntity = health.spawn(100, 100);

      assert.strictEqual(hasComponent(world, posEntity, Position), true);
      assert.strictEqual(hasComponent(world, posEntity, Health), false);

      assert.strictEqual(hasComponent(world, healthEntity, Health), true);
      assert.strictEqual(hasComponent(world, healthEntity, Position), false);
    });

    it("each definition cached independently", () => {
      const actionsA = defineActions((world) => ({
        a: () => world,
      }));

      const actionsB = defineActions((world) => ({
        b: () => world,
      }));

      const world = createWorld();

      actionsA(world);
      actionsB(world);

      assert.strictEqual(world.actions.byInitializer.size, 2);
    });

    it("actions from different definitions can interact", () => {
      const spawnActions = defineActions((world) => ({
        spawn(): Entity {
          return createEntity(world);
        },
      }));

      const componentActions = defineActions((world) => ({
        addPosition(entity: Entity, x: number, y: number): void {
          addComponent(world, entity, Position, { x, y });
        },
        addHealth(entity: Entity, hp: number): void {
          addComponent(world, entity, Health, { current: hp, max: hp });
        },
      }));

      const world = createWorld();
      const spawn = spawnActions(world);
      const components = componentActions(world);

      const entity = spawn.spawn();
      components.addPosition(entity, 50, 75);
      components.addHealth(entity, 100);

      assert.strictEqual(getComponentValue(world, entity, Position, "x"), 50);
      assert.strictEqual(getComponentValue(world, entity, Health, "current"), 100);
    });
  });

  // ============================================================================
  // Return Value Tests
  // ============================================================================

  describe("Return Values", () => {
    it("actions can return entities", () => {
      const testActions = defineActions((world) => ({
        spawn(): Entity {
          return createEntity(world);
        },
      }));

      const world = createWorld();
      const actions = testActions(world);
      const entity = actions.spawn();

      assert.strictEqual(typeof entity, "number");
      assert.strictEqual(world.entities.byId.has(entity), true);
    });

    it("actions can return booleans", () => {
      const testActions = defineActions((world) => ({
        hasEntity(entity: Entity): boolean {
          return world.entities.byId.has(entity);
        },
        entityHasPosition(entity: Entity): boolean {
          return hasComponent(world, entity, Position);
        },
      }));

      const world = createWorld();
      const actions = testActions(world);
      const entity = createEntity(world);

      assert.strictEqual(actions.hasEntity(entity), true);
      assert.strictEqual(actions.entityHasPosition(entity), false);

      addComponent(world, entity, Position, { x: 0, y: 0 });

      assert.strictEqual(actions.entityHasPosition(entity), true);
    });

    it("actions can return objects", () => {
      const testActions = defineActions((world) => ({
        spawnWithInfo(name: string): { entity: Entity; name: string; tick: number } {
          const entity = createEntity(world);
          return { entity, name, tick: world.execution.tick };
        },
      }));

      const world = createWorld();
      const actions = testActions(world);
      const result = actions.spawnWithInfo("player");

      assert.strictEqual(typeof result.entity, "number");
      assert.strictEqual(result.name, "player");
      assert.strictEqual(result.tick, world.execution.tick);
    });
  });

  // ============================================================================
  // Stateful Actions Tests
  // ============================================================================

  describe("Stateful Actions", () => {
    it("closure state persists across calls", () => {
      const testActions = defineActions((world) => {
        let count = 0;
        return {
          spawn(): Entity {
            count++;
            return createEntity(world);
          },
          getCount(): number {
            return count;
          },
        };
      });

      const world = createWorld();
      const actions = testActions(world);

      assert.strictEqual(actions.getCount(), 0);

      actions.spawn();
      assert.strictEqual(actions.getCount(), 1);

      actions.spawn();
      actions.spawn();
      assert.strictEqual(actions.getCount(), 3);
    });

    it("closure state is isolated per world", () => {
      const testActions = defineActions((world) => {
        let count = 0;
        return {
          spawn(): Entity {
            count++;
            return createEntity(world);
          },
          getCount(): number {
            return count;
          },
        };
      });

      const world1 = createWorld();
      const world2 = createWorld();

      const actions1 = testActions(world1);
      const actions2 = testActions(world2);

      actions1.spawn();
      actions1.spawn();
      actions1.spawn();

      actions2.spawn();

      assert.strictEqual(actions1.getCount(), 3);
      assert.strictEqual(actions2.getCount(), 1);
    });

    it("closure state shared across all uses of same world", () => {
      const counterActions = defineActions((world) => {
        let count = 0;
        return {
          increment(): void {
            count++;
            void world;
          },
          getCount(): number {
            return count;
          },
        };
      });

      const world = createWorld();

      // Simulate multiple "systems" using the same actions
      const systemA = counterActions(world);
      const systemB = counterActions(world);

      systemA.increment();
      systemB.increment();
      systemA.increment();

      // All share the same state
      assert.strictEqual(systemA.getCount(), 3);
      assert.strictEqual(systemB.getCount(), 3);
    });

    it("closure can hold complex state", () => {
      const poolActions = defineActions((world) => {
        const pool: Entity[] = [];

        return {
          acquire(): Entity {
            if (pool.length > 0) {
              return pool.pop()!;
            }
            return createEntity(world);
          },
          release(entity: Entity): void {
            pool.push(entity);
          },
          poolSize(): number {
            return pool.length;
          },
        };
      });

      const world = createWorld();
      const pool = poolActions(world);

      // Acquire creates new entities
      const e1 = pool.acquire();
      const e2 = pool.acquire();
      assert.strictEqual(pool.poolSize(), 0);

      // Release returns to pool
      pool.release(e1);
      pool.release(e2);
      assert.strictEqual(pool.poolSize(), 2);

      // Acquire reuses from pool
      const e3 = pool.acquire();
      assert.strictEqual(pool.poolSize(), 1);
      assert.ok(e3 === e1 || e3 === e2);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("Edge Cases", () => {
    it("handles empty actions object", () => {
      const emptyActions = defineActions(() => {
        return {};
      });

      const world = createWorld();
      const actions = emptyActions(world);

      assert.deepStrictEqual(Object.keys(actions), []);
    });

    it("different initializers with same logic create different caches", () => {
      // Two separate defineActions calls create separate initializers
      const actionsA = defineActions(() => ({
        noop(): void {},
      }));

      const actionsB = defineActions(() => ({
        noop(): void {},
      }));

      const world = createWorld();

      const a = actionsA(world);
      const b = actionsB(world);

      assert.notStrictEqual(a, b);
      assert.strictEqual(world.actions.byInitializer.size, 2);
    });
  });
});
