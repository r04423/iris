import { type Component, cacheQuery, type QueryMeta, queryEntities, type World } from "iris-ecs";
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

type QueryPoolWorld = World & { __queryMeta: QueryMeta<Component>; __sink: number };

// ============================================================================
// Shorthand alias
// ============================================================================

const C = GENERATED_COMPONENTS;

// ============================================================================
// Helpers
// ============================================================================

function countMatches(world: World, meta: QueryMeta<Component>): number {
  let count = 0;
  queryEntities(world, meta, () => {
    count++;
  });
  return count;
}

// ============================================================================
// Benchmarks
// ============================================================================

function queryBenchmarks(): BenchmarkDef[] {
  return [
    {
      name: "iter all",
      presets: allPresets,
      entityCount(world: World) {
        return countMatches(world, (world as QueryPoolWorld).__queryMeta);
      },
      setup(world: World) {
        const w = world as QueryPoolWorld;
        w.__queryMeta = cacheQuery(world, C[0]!);
        w.__sink = 0;
      },
      fn(world: World) {
        const w = world as QueryPoolWorld;
        let sink = 0;
        queryEntities(world, w.__queryMeta, (entity) => {
          sink += entity as number;
        });
        w.__sink = sink;
      },
    },
    {
      name: "iter selective",
      presets: allPresets,
      entityCount(world: World) {
        return countMatches(world, (world as QueryPoolWorld).__queryMeta);
      },
      setup(world: World) {
        const w = world as QueryPoolWorld;
        w.__queryMeta = cacheQuery(world, C[0]!, C[1]!);
        w.__sink = 0;
      },
      fn(world: World) {
        const w = world as QueryPoolWorld;
        let sink = 0;
        queryEntities(world, w.__queryMeta, (entity) => {
          sink += entity as number;
        });
        w.__sink = sink;
      },
    },
    {
      name: "iter narrow",
      presets: narrowPresets,
      entityCount(world: World) {
        return countMatches(world, (world as QueryPoolWorld).__queryMeta);
      },
      setup(world: World) {
        const w = world as QueryPoolWorld;
        w.__queryMeta = cacheQuery(world, C[10]!);
        w.__sink = 0;
      },
      fn(world: World) {
        const w = world as QueryPoolWorld;
        let sink = 0;
        queryEntities(world, w.__queryMeta, (entity) => {
          sink += entity as number;
        });
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
