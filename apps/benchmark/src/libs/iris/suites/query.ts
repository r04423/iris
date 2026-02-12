import { ensureQuery, fetchEntitiesWithQuery, type QueryMeta, type World } from "iris-ecs";
import type { BenchmarkDef, PresetName } from "../../../types.js";
import { GENERATED_COMPONENTS } from "../fixtures.js";

// ============================================================================
// Presets
// ============================================================================

const allPresets: PresetName[] = ["xsmall", "small", "medium", "large"];
const narrowPresets: PresetName[] = ["small", "medium", "large"];

// ============================================================================
// World extension for cached query state
// ============================================================================

type QueryPoolWorld = World & { __queryMeta: QueryMeta; __sink: number };

// ============================================================================
// Shorthand alias
// ============================================================================

const C = GENERATED_COMPONENTS;

// ============================================================================
// Benchmarks
// ============================================================================

function queryBenchmarks(): BenchmarkDef[] {
  return [
    {
      name: "iter all",
      presets: allPresets,
      entityCount: { xsmall: 100, small: 1_000, medium: 10_000, large: 100_000 },
      setup(world: World) {
        const w = world as QueryPoolWorld;
        w.__queryMeta = ensureQuery(world, C[0]!);
        w.__sink = 0;
      },
      fn(world: World) {
        const w = world as QueryPoolWorld;
        let sink = 0;
        for (const entity of fetchEntitiesWithQuery(world, w.__queryMeta)) {
          sink += entity as number;
        }
        w.__sink = sink;
      },
    },
    {
      name: "iter selective",
      presets: allPresets,
      entityCount: { xsmall: 45, small: 440, medium: 4_300, large: 44_700 },
      setup(world: World) {
        const w = world as QueryPoolWorld;
        w.__queryMeta = ensureQuery(world, C[0]!, C[1]!);
        w.__sink = 0;
      },
      fn(world: World) {
        const w = world as QueryPoolWorld;
        let sink = 0;
        for (const entity of fetchEntitiesWithQuery(world, w.__queryMeta)) {
          sink += entity as number;
        }
        w.__sink = sink;
      },
    },
    {
      name: "iter narrow",
      presets: narrowPresets,
      entityCount: { small: 36, medium: 490, large: 7_300 },
      setup(world: World) {
        const w = world as QueryPoolWorld;
        w.__queryMeta = ensureQuery(world, C[10]!);
        w.__sink = 0;
      },
      fn(world: World) {
        const w = world as QueryPoolWorld;
        let sink = 0;
        for (const entity of fetchEntitiesWithQuery(world, w.__queryMeta)) {
          sink += entity as number;
        }
        w.__sink = sink;
      },
    },
  ];
}

// ============================================================================
// Suite export
// ============================================================================

export const suite = {
  name: "Query",
  benchmarks: queryBenchmarks(),
};
