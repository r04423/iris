import { addComponent, createEntity, destroyEntity, type Entity, type World } from "iris-ecs";
import type { BenchmarkDef, PresetName } from "../../../types.js";
import { Active, Enemy, Health, Player, Position, Velocity, Visible } from "../fixtures.js";

// ---------------------------------------------------------------------------
// Component sets by size
// ---------------------------------------------------------------------------

const componentSets = [
  { label: "empty entity", components: [], tags: [] },
  { label: "entity + 2 comps", components: [Position], tags: [Player] },
  { label: "entity + 4 comps", components: [Position, Velocity], tags: [Player, Enemy] },
  {
    label: "entity + 8 comps",
    components: [Position, Velocity, Health],
    tags: [Player, Enemy, Active, Visible],
  },
] as const;

type CompSet = {
  label: string;
  components: readonly (typeof Position | typeof Velocity | typeof Health)[];
  tags: readonly (typeof Player | typeof Enemy | typeof Active | typeof Visible)[];
};

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const allPresets: PresetName[] = ["empty", "xsmall", "small"];
const destroyPresets: PresetName[] = ["xsmall", "small"];

// ---------------------------------------------------------------------------
// Helper — populate entity with a component set
// ---------------------------------------------------------------------------

/**
 * addComponent requires typed data matching the component schema, so we
 * dispatch by identity rather than using a generic loop. This is only used
 * in setup/benchmark functions, not in a hot path.
 */
function addComponentSet(world: World, e: Entity, set: CompSet): void {
  for (let c = 0; c < set.components.length; c++) {
    const comp = set.components[c]!;
    if (comp === Position) {
      addComponent(world, e, Position, { x: 0, y: 0 });
    } else if (comp === Velocity) {
      addComponent(world, e, Velocity, { vx: 0, vy: 0 });
    } else {
      addComponent(world, e, Health, { hp: 100 });
    }
  }
  for (let t = 0; t < set.tags.length; t++) {
    addComponent(world, e, set.tags[t]!);
  }
}

// ---------------------------------------------------------------------------
// Generate create benchmarks
// ---------------------------------------------------------------------------

function createBenchmarks(): BenchmarkDef[] {
  const defs: BenchmarkDef[] = [];

  for (let s = 0; s < componentSets.length; s++) {
    const set = componentSets[s] as CompSet;

    defs.push({
      name: `create ${set.label}`,
      presets: allPresets,
      fn(world: World) {
        const e = createEntity(world);
        addComponentSet(world, e, set);
      },
    });
  }

  return defs;
}

// ---------------------------------------------------------------------------
// Generate destroy benchmarks
// ---------------------------------------------------------------------------

/**
 * Destroy benchmarks pre-create a pool of entities in setup, then consume one
 * per iteration. The pool must be larger than warmupIterations + iterations
 * (currently 1,024 + 8,192 = 9,216) to avoid measuring no-ops on dead entities.
 */
const DESTROY_POOL_SIZE = 10_000;

function destroyBenchmarks(): BenchmarkDef[] {
  const defs: BenchmarkDef[] = [];

  for (let s = 0; s < componentSets.length; s++) {
    const set = componentSets[s] as CompSet;

    defs.push({
      name: `destroy ${set.label}`,
      presets: destroyPresets,
      setup(world: World) {
        const pool: Entity[] = [];
        for (let i = 0; i < DESTROY_POOL_SIZE; i++) {
          const e = createEntity(world);
          addComponentSet(world, e, set);
          pool.push(e);
        }
        (world as World & { __destroyPool: Entity[] }).__destroyPool = pool;
        (world as World & { __destroyIdx: number }).__destroyIdx = 0;
      },
      fn(world: World) {
        const pool = (world as World & { __destroyPool: Entity[] }).__destroyPool;
        const idx = (world as World & { __destroyIdx: number }).__destroyIdx;
        if (idx >= pool.length) return;
        destroyEntity(world, pool[idx]!);
        (world as World & { __destroyIdx: number }).__destroyIdx = idx + 1;
      },
    });
  }

  return defs;
}

// ---------------------------------------------------------------------------
// Suite export
// ---------------------------------------------------------------------------

export const suite = {
  name: "Entity",
  benchmarks: [...createBenchmarks(), ...destroyBenchmarks()],
};
