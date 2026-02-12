import { createEntity, destroyEntity, type Entity, type World } from "iris-ecs";
import type { BenchmarkDef, PresetName } from "../../../types.js";
import { addTemplateTypes, GROUPS, generateTemplatePool, POOL_SIZE, type TemplateAssignment } from "../pool.js";

// ============================================================================
// Presets
// ============================================================================

const allPresets: PresetName[] = ["empty", "xsmall", "small", "medium", "large"];
const destroyPresets: PresetName[] = ["xsmall", "small", "medium", "large"];

// ============================================================================
// World extensions for pool state
// ============================================================================

type CreatePoolWorld = World & {
  __assignments: TemplateAssignment[];
  __assignIdx: number;
};

type DestroyPoolWorld = World & {
  __destroyPool: Entity[];
  __destroyIdx: number;
};

// ============================================================================
// Generate create benchmarks
// ============================================================================

function createBenchmarks(): BenchmarkDef[] {
  const defs: BenchmarkDef[] = [];

  // Create empty entity (no setup needed)
  defs.push({
    name: "create empty entity",
    presets: allPresets,
    fn(world: World) {
      createEntity(world);
    },
  });

  // Create entity + N types (template-based)
  for (const group of GROUPS) {
    defs.push({
      name: `create entity + ${group.width} types`,
      presets: allPresets,
      setup(world: World) {
        const w = world as CreatePoolWorld;
        w.__assignments = generateTemplatePool(POOL_SIZE, group, { seed: 789 });
        w.__assignIdx = 0;
      },
      fn(world: World) {
        const w = world as CreatePoolWorld;
        if (w.__assignIdx >= w.__assignments.length) return;
        const e = createEntity(world);
        addTemplateTypes(world, e, w.__assignments[w.__assignIdx]!.template);
        w.__assignIdx++;
      },
    });
  }

  return defs;
}

// ============================================================================
// Generate destroy benchmarks
// ============================================================================

function destroyBenchmarks(): BenchmarkDef[] {
  const defs: BenchmarkDef[] = [];

  // Destroy empty entity
  defs.push({
    name: "destroy empty entity",
    presets: destroyPresets,
    setup(world: World) {
      const pool: Entity[] = [];
      for (let i = 0; i < POOL_SIZE; i++) {
        pool.push(createEntity(world));
      }
      (world as DestroyPoolWorld).__destroyPool = pool;
      (world as DestroyPoolWorld).__destroyIdx = 0;
    },
    fn(world: World) {
      const w = world as DestroyPoolWorld;
      if (w.__destroyIdx >= w.__destroyPool.length) return;
      destroyEntity(world, w.__destroyPool[w.__destroyIdx]!);
      w.__destroyIdx++;
    },
  });

  // Destroy entity + N types (template-based)
  for (const group of GROUPS) {
    const assignments = generateTemplatePool(POOL_SIZE, group, { seed: 789 });

    defs.push({
      name: `destroy entity + ${group.width} types`,
      presets: destroyPresets,
      setup(world: World) {
        const pool: Entity[] = [];
        for (let i = 0; i < POOL_SIZE; i++) {
          const e = createEntity(world);
          addTemplateTypes(world, e, assignments[i]!.template);
          pool.push(e);
        }
        (world as DestroyPoolWorld).__destroyPool = pool;
        (world as DestroyPoolWorld).__destroyIdx = 0;
      },
      fn(world: World) {
        const w = world as DestroyPoolWorld;
        if (w.__destroyIdx >= w.__destroyPool.length) return;
        destroyEntity(world, w.__destroyPool[w.__destroyIdx]!);
        w.__destroyIdx++;
      },
    });
  }

  return defs;
}

// ============================================================================
// Suite export
// ============================================================================

export const suite = {
  name: "Entity",
  benchmarks: [...createBenchmarks(), ...destroyBenchmarks()],
};
