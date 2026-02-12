import {
  addComponent,
  type Component,
  createEntity,
  type Entity,
  type EntityId,
  getComponentValue,
  hasComponent,
  removeComponent,
  setComponentValue,
  type World,
} from "iris-ecs";
import type { BenchmarkDef, PresetName } from "../../../types.js";
import { ADD_TARGET, addTemplateTypes, GROUPS, generateTemplatePool, POOL_SIZE } from "../pool.js";

// ============================================================================
// Presets
// ============================================================================

const allPresets: PresetName[] = ["empty", "xsmall", "small", "medium", "large"];
const removePresets: PresetName[] = ["xsmall", "small", "medium", "large"];

// ============================================================================
// World extensions for pool state
// ============================================================================

type AddPoolWorld = World & {
  __addPool: Entity[];
  __addTargets: Component[];
  __addIdx: number;
};

type RemovePoolWorld = World & {
  __removePool: Entity[];
  __removeTargets: EntityId[];
  __removeIdx: number;
};

type AccessPoolWorld = World & {
  __accessPool: Entity[];
  __accessHasTargets: EntityId[];
  __accessCompTargets: Component[];
  __accessIdx: number;
};

// ============================================================================
// Generate addComponent benchmarks
// ============================================================================

function addComponentBenchmarks(): BenchmarkDef[] {
  const defs: BenchmarkDef[] = [];

  // Add comp to empty entity, constant ADD_TARGET (nothing template-specific to randomize)
  defs.push({
    name: "add comp to empty entity",
    presets: allPresets,
    setup(world: World) {
      const pool: Entity[] = [];
      for (let i = 0; i < POOL_SIZE; i++) {
        pool.push(createEntity(world));
      }
      const w = world as AddPoolWorld;
      w.__addPool = pool;
      w.__addTargets = [];
      w.__addIdx = 0;
    },
    fn(world: World) {
      const w = world as AddPoolWorld;
      if (w.__addIdx >= w.__addPool.length) return;
      // biome-ignore lint/suspicious/noExplicitAny: all pool components share { v: f32 } schema
      addComponent(world, w.__addPool[w.__addIdx]!, ADD_TARGET as any, { v: 0 });
      w.__addIdx++;
    },
  });

  // Add comp to N-type entity (template-based, randomized add targets)
  for (const group of GROUPS) {
    const assignments = generateTemplatePool(POOL_SIZE, group, { seed: 789 });

    defs.push({
      name: `add comp to ${group.width}-type entity`,
      presets: allPresets,
      setup(world: World) {
        const pool: Entity[] = [];
        const targets: Component[] = [];
        for (let i = 0; i < POOL_SIZE; i++) {
          const e = createEntity(world);
          addTemplateTypes(world, e, assignments[i]!.template);
          pool.push(e);
          targets.push(assignments[i]!.addTarget);
        }
        const w = world as AddPoolWorld;
        w.__addPool = pool;
        w.__addTargets = targets;
        w.__addIdx = 0;
      },
      fn(world: World) {
        const w = world as AddPoolWorld;
        if (w.__addIdx >= w.__addPool.length) return;
        // biome-ignore lint/suspicious/noExplicitAny: all pool components share { v: f32 } schema
        addComponent(world, w.__addPool[w.__addIdx]!, w.__addTargets[w.__addIdx]! as any, { v: 0 });
        w.__addIdx++;
      },
    });
  }

  return defs;
}

// ============================================================================
// Generate removeComponent benchmarks
// ============================================================================

function removeComponentBenchmarks(): BenchmarkDef[] {
  const defs: BenchmarkDef[] = [];

  for (const group of GROUPS) {
    const assignments = generateTemplatePool(POOL_SIZE, group, { seed: 789 });

    defs.push({
      name: `remove comp from ${group.width}-type entity`,
      presets: removePresets,
      setup(world: World) {
        const pool: Entity[] = [];
        const targets: EntityId[] = [];
        for (let i = 0; i < POOL_SIZE; i++) {
          const e = createEntity(world);
          addTemplateTypes(world, e, assignments[i]!.template);
          pool.push(e);
          targets.push(assignments[i]!.removeTarget);
        }
        const w = world as RemovePoolWorld;
        w.__removePool = pool;
        w.__removeTargets = targets;
        w.__removeIdx = 0;
      },
      fn(world: World) {
        const w = world as RemovePoolWorld;
        if (w.__removeIdx >= w.__removePool.length) return;
        removeComponent(world, w.__removePool[w.__removeIdx]!, w.__removeTargets[w.__removeIdx]!);
        w.__removeIdx++;
      },
    });
  }

  return defs;
}

// ============================================================================
// Generate access benchmarks (has / get / set)
// ============================================================================

/**
 * Access benchmarks use group 4 templates (4 types). Group size doesn't
 * affect access cost. Lookup is O(1) regardless
 * of archetype width. 5 templates with power-law distribution provide
 * archetype diversity.
 *
 * These benchmarks cycle through the pool (modular wrap) since they don't
 * consume entities.
 */
function accessBenchmarks(): BenchmarkDef[] {
  const assignments = generateTemplatePool(POOL_SIZE, GROUPS[1]!, { seed: 789 });

  function setupAccess(world: World): void {
    const pool: Entity[] = [];
    const hasTargets: EntityId[] = [];
    const compTargets: Component[] = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = assignments[i]!;
      const e = createEntity(world);
      addTemplateTypes(world, e, a.template);
      pool.push(e);
      hasTargets.push(a.hasTarget);
      compTargets.push(a.componentTarget);
    }
    const w = world as AccessPoolWorld;
    w.__accessPool = pool;
    w.__accessHasTargets = hasTargets;
    w.__accessCompTargets = compTargets;
    w.__accessIdx = 0;
  }

  return [
    {
      name: "hasComponent",
      presets: allPresets,
      setup: setupAccess,
      fn(world: World) {
        const w = world as AccessPoolWorld;
        const idx = w.__accessIdx % w.__accessPool.length;
        hasComponent(world, w.__accessPool[idx]!, w.__accessHasTargets[idx]!);
        w.__accessIdx++;
      },
    },
    {
      name: "getComponentValue",
      presets: allPresets,
      setup: setupAccess,
      fn(world: World) {
        const w = world as AccessPoolWorld;
        const idx = w.__accessIdx % w.__accessPool.length;
        // biome-ignore lint/suspicious/noExplicitAny: all pool components share { v: f32 } schema
        getComponentValue(world, w.__accessPool[idx]!, w.__accessCompTargets[idx]! as any, "v");
        w.__accessIdx++;
      },
    },
    {
      name: "setComponentValue",
      presets: allPresets,
      setup: setupAccess,
      fn(world: World) {
        const w = world as AccessPoolWorld;
        const idx = w.__accessIdx % w.__accessPool.length;
        // biome-ignore lint/suspicious/noExplicitAny: all pool components share { v: f32 } schema
        setComponentValue(world, w.__accessPool[idx]!, w.__accessCompTargets[idx]! as any, "v", 1.0);
        w.__accessIdx++;
      },
    },
  ];
}

// ============================================================================
// Suite export
// ============================================================================

export const suite = {
  name: "Component",
  benchmarks: [...addComponentBenchmarks(), ...removeComponentBenchmarks(), ...accessBenchmarks()],
};
