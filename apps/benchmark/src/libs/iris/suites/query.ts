import {
  type Component,
  cacheQuery,
  type EntityId,
  getComponentValue,
  type QueryMeta,
  queryColumns,
  queryEntities,
  setComponentValue,
  type World,
} from "iris-ecs";
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
        w.__queryMeta = cacheQuery<[Component]>(world, [C[0]!]);
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
        w.__queryMeta = cacheQuery<[Component, Component]>(world, [C[0]!, C[1]!]);
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
        w.__queryMeta = cacheQuery<[Component]>(world, [C[10]!]);
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

    // ---- queryColumns: pure iteration (same work as above, per-archetype batching) ----

    {
      name: "columns iter all",
      presets: allPresets,
      entityCount(world: World) {
        return countMatches(world, (world as QueryPoolWorld).__queryMeta);
      },
      setup(world: World) {
        const w = world as QueryPoolWorld;
        w.__queryMeta = cacheQuery<[Component]>(world, [C[0]!]);
        w.__sink = 0;
      },
      fn(world: World) {
        const w = world as QueryPoolWorld;
        let sink = 0;
        queryColumns(world, w.__queryMeta, (entities: EntityId[]) => {
          for (let i = 0; i < entities.length; i++) {
            sink += entities[i] as number;
          }
        });
        w.__sink = sink;
      },
    },
    {
      name: "columns iter selective",
      presets: allPresets,
      entityCount(world: World) {
        return countMatches(world, (world as QueryPoolWorld).__queryMeta);
      },
      setup(world: World) {
        const w = world as QueryPoolWorld;
        w.__queryMeta = cacheQuery<[Component, Component]>(world, [C[0]!, C[1]!]);
        w.__sink = 0;
      },
      fn(world: World) {
        const w = world as QueryPoolWorld;
        let sink = 0;
        queryColumns(world, w.__queryMeta, (entities: EntityId[]) => {
          for (let i = 0; i < entities.length; i++) {
            sink += entities[i] as number;
          }
        });
        w.__sink = sink;
      },
    },
    {
      name: "columns iter narrow",
      presets: narrowPresets,
      entityCount(world: World) {
        return countMatches(world, (world as QueryPoolWorld).__queryMeta);
      },
      setup(world: World) {
        const w = world as QueryPoolWorld;
        w.__queryMeta = cacheQuery<[Component]>(world, [C[10]!]);
        w.__sink = 0;
      },
      fn(world: World) {
        const w = world as QueryPoolWorld;
        let sink = 0;
        queryColumns(world, w.__queryMeta, (entities: EntityId[]) => {
          for (let i = 0; i < entities.length; i++) {
            sink += entities[i] as number;
          }
        });
        w.__sink = sink;
      },
    },

    // ---- Data access: increment via queryEntities + get/set vs queryColumns + columns ----

    {
      name: "increment via entities",
      presets: allPresets,
      entityCount(world: World) {
        return countMatches(world, (world as QueryPoolWorld).__queryMeta);
      },
      setup(world: World) {
        const w = world as QueryPoolWorld;
        w.__queryMeta = cacheQuery<[Component]>(world, [C[0]!]);
        w.__sink = 0;
      },
      fn(world: World) {
        const w = world as QueryPoolWorld;
        queryEntities(world, w.__queryMeta, (entity) => {
          const v = getComponentValue(world, entity, C[0]!, "v") as number;
          setComponentValue(world, entity, C[0]!, "v", v + 1);
        });
      },
    },
    {
      name: "increment via columns",
      presets: allPresets,
      entityCount(world: World) {
        return countMatches(world, (world as QueryPoolWorld).__queryMeta);
      },
      setup(world: World) {
        const w = world as QueryPoolWorld;
        w.__queryMeta = cacheQuery<[Component]>(world, [C[0]!]);
        w.__sink = 0;
      },
      fn(world: World) {
        const w = world as QueryPoolWorld;
        // biome-ignore lint/suspicious/noExplicitAny: generated components lack static schema types
        (queryColumns as any)(world, w.__queryMeta, (entities: EntityId[], col: { v: Float32Array }) => {
          const v = col.v;
          for (let i = 0; i < entities.length; i++) {
            v[i]! += 1;
          }
        });
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
