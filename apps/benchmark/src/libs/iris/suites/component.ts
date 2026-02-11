import {
  addComponent,
  createEntity,
  type Entity,
  getComponentValue,
  hasComponent,
  removeComponent,
  setComponentValue,
  type World,
} from "iris-ecs";
import type { BenchmarkDef, PresetName } from "../../../types.js";
import { Active, Damage, Enemy, Health, Player, Position, Velocity, Visible } from "../fixtures.js";

// ---------------------------------------------------------------------------
// Component sets by size
// ---------------------------------------------------------------------------

const componentSets = [
  { label: "empty entity", components: [], tags: [] },
  { label: "2-comp entity", components: [Position], tags: [Player] },
  { label: "4-comp entity", components: [Position, Velocity], tags: [Player, Enemy] },
  {
    label: "8-comp entity",
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

const allPresets: PresetName[] = ["empty", "xsmall", "small", "medium"];
const removePresets: PresetName[] = ["xsmall", "small", "medium"];

// ---------------------------------------------------------------------------
// Helper — populate entity with a component set
// ---------------------------------------------------------------------------

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
// Pool size
// ---------------------------------------------------------------------------

const POOL_SIZE = 10_000;

// ---------------------------------------------------------------------------
// Generate addComponent benchmarks
// ---------------------------------------------------------------------------

type AddPoolWorld = World & { __addPool: Entity[]; __addIdx: number };

function addComponentBenchmarks(): BenchmarkDef[] {
  const defs: BenchmarkDef[] = [];

  for (let s = 0; s < componentSets.length; s++) {
    const set = componentSets[s] as CompSet;

    defs.push({
      name: `add comp to ${set.label}`,
      presets: allPresets,
      setup(world: World) {
        const pool: Entity[] = [];
        for (let i = 0; i < POOL_SIZE; i++) {
          const e = createEntity(world);
          addComponentSet(world, e, set);
          pool.push(e);
        }
        (world as AddPoolWorld).__addPool = pool;
        (world as AddPoolWorld).__addIdx = 0;
      },
      fn(world: World) {
        const w = world as AddPoolWorld;
        if (w.__addIdx >= w.__addPool.length) return;
        addComponent(world, w.__addPool[w.__addIdx]!, Damage, { amount: 10 });
        w.__addIdx++;
      },
    });
  }

  return defs;
}

// ---------------------------------------------------------------------------
// Generate removeComponent benchmarks
// ---------------------------------------------------------------------------

type RemovePoolWorld = World & { __removePool: Entity[]; __removeIdx: number };

function removeComponentBenchmarks(): BenchmarkDef[] {
  const defs: BenchmarkDef[] = [];

  for (let s = 0; s < componentSets.length; s++) {
    const set = componentSets[s] as CompSet;
    const totalBefore = set.components.length + set.tags.length + 1; // base + Damage

    defs.push({
      name: `remove comp from ${totalBefore}-comp entity`,
      presets: removePresets,
      setup(world: World) {
        const pool: Entity[] = [];
        for (let i = 0; i < POOL_SIZE; i++) {
          const e = createEntity(world);
          addComponentSet(world, e, set);
          addComponent(world, e, Damage, { amount: 10 });
          pool.push(e);
        }
        (world as RemovePoolWorld).__removePool = pool;
        (world as RemovePoolWorld).__removeIdx = 0;
      },
      fn(world: World) {
        const w = world as RemovePoolWorld;
        if (w.__removeIdx >= w.__removePool.length) return;
        removeComponent(world, w.__removePool[w.__removeIdx]!, Damage);
        w.__removeIdx++;
      },
    });
  }

  return defs;
}

// ---------------------------------------------------------------------------
// Generate access benchmarks (has / get / set)
// ---------------------------------------------------------------------------

type TargetWorld = World & { __target: Entity };

function accessBenchmarks(): BenchmarkDef[] {
  const setup = (world: World) => {
    const e = createEntity(world);
    addComponent(world, e, Position, { x: 0, y: 0 });
    addComponent(world, e, Player);
    (world as TargetWorld).__target = e;
  };

  return [
    {
      name: "hasComponent",
      presets: allPresets,
      setup,
      fn(world: World) {
        hasComponent(world, (world as TargetWorld).__target, Position);
      },
    },
    {
      name: "getComponentValue",
      presets: allPresets,
      setup,
      fn(world: World) {
        getComponentValue(world, (world as TargetWorld).__target, Position, "x");
      },
    },
    {
      name: "setComponentValue",
      presets: allPresets,
      setup,
      fn(world: World) {
        setComponentValue(world, (world as TargetWorld).__target, Position, "x", 1.0);
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Suite export
// ---------------------------------------------------------------------------

export const suite = {
  name: "Component",
  benchmarks: [...addComponentBenchmarks(), ...removeComponentBenchmarks(), ...accessBenchmarks()],
};
