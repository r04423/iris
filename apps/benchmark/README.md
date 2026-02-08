# iris-benchmark

Performance benchmark harness for `iris-ecs`, built on [tinybench](https://github.com/tinylibs/tinybench).

Use this to detect regressions, compare optimization strategies, and validate performance claims. Results are machine-sensitive -- use for local iteration and relative comparisons on the same hardware.

## Modes

The harness supports two measurement modes:

**Throughput** (default) runs each benchmark for a fixed number of iterations and reports `ops/sec`, `avg`, `P75`, and `P99` latency.

**Memory** measures heap impact by taking GC-fenced snapshots before and after a batch of iterations. Heap measurements are inherently noisy, so the harness runs multiple independent samples per benchmark and reports the median.

## Presets

Each benchmark runs against one or more **world presets** -- pre-populated worlds of varying size:

| Preset | Entities | Component types | Tag types | Active queries |
|--------|----------|-----------------|-----------|----------------|
| empty  | 0        | 0               | 0         | 0              |
| xsmall | 100      | 24              | 24        | 20             |
| small  | 1,000    | 104             | 104       | 100            |
| medium | 10,000   | 404             | 404       | 400            |

Entities receive semi-random component subsets (deterministic seed) so the world contains multiple archetypes rather than one monolithic table. Queries are pre-executed to populate internal caches. This reflects realistic usage where larger worlds accumulate type diversity and query pressure.

## Commands

From repo root:

```sh
pnpm bench                                # all suites, throughput mode
pnpm --filter iris-benchmark bench Entity  # single suite
pnpm --filter iris-benchmark bench:memory  # all suites, memory mode
```

From `apps/benchmark`:

```sh
pnpm bench                   # all suites, throughput mode
pnpm bench Entity            # single suite
pnpm bench:memory            # all suites, memory mode
pnpm bench:compare           # all registered library adapters
pnpm typecheck               # typecheck benchmark code
```

## Multi-Library Support

The harness supports benchmarking multiple ECS libraries behind a `--lib` flag. Each library implements a `LibraryAdapter` (see `src/libs/types.ts`) providing its own presets and suites. The runner is library-agnostic -- it calls `factory()` and passes the result to `def.fn(world)`.

```sh
pnpm bench --lib iris        # run only iris (default)
pnpm bench --lib all         # run all registered adapters
```

## Adding a Library Adapter

1. Create `src/libs/<name>/` with:
   - `fixtures.ts` — component/tag definitions
   - `presets.ts` — preset factories matching the standard preset sizes
   - `suites/<suite>.ts` — benchmark definitions using the library's API
   - `index.ts` — exports a `LibraryAdapter`

2. Register in `src/main.ts`:

```typescript
import { myLib } from "./libs/my-lib/index.js";

const allAdapters: LibraryAdapter[] = [iris, myLib];
```

3. Verify: `pnpm typecheck && pnpm bench --lib all`

## Adding a Suite

1. Create a file in `src/libs/iris/suites/` that exports a `suite` object:

```typescript
import type { Suite } from "../../../types.js";

export const suite: Suite = {
  name: "MyFeature",
  benchmarks: [
    {
      name: "some operation",
      presets: ["empty", "xsmall", "small", "medium"],
      fn(world) { /* measured operation */ },
      setup(world) { /* optional one-time setup */ },
    },
  ],
};
```

2. Register it in `src/libs/iris/index.ts`:

```typescript
import { suite as myFeatureSuite } from "./suites/my-feature.js";

export const iris: LibraryAdapter = {
  name: "iris",
  presets,
  suites: [entitySuite, myFeatureSuite],
};
```

3. Verify: `pnpm typecheck && pnpm bench`

## Results

> Apple M4 (10-core), 24 GB RAM, macOS 26.2, Node.js v25.0.0
>
> Fixed 8,192 iterations per benchmark. `ops/frame` = operations per 16.67 ms frame at 60 fps.

### Entity — Create Throughput

Latency — avg (P99):

| Benchmark | empty | xsmall | small | medium |
|-----------|------:|-------:|------:|-------:|
| create empty entity | 150 ns (209 ns) | 145 ns (666 ns) | 130 ns (417 ns) | 183 ns (459 ns) |
| create entity + 2 comps | 540 ns (1.37 us) | 454 ns (1.25 us) | 397 ns (541 ns) | 423 ns (757 ns) |
| create entity + 4 comps | 857 ns (921 ns) | 862 ns (1.71 us) | 815 ns (959 ns) | 919 ns (1.34 us) |
| create entity + 8 comps | 1.62 us (1.83 us) | 1.76 us (4.94 us) | 1.55 us (1.84 us) | 1.65 us (2.21 us) |

ops/sec (ops/frame):

| Benchmark | empty | xsmall | small | medium |
|-----------|------:|-------:|------:|-------:|
| create empty entity | 6,682,356 (111,373) | 6,890,467 (114,841) | 7,668,768 (127,813) | 5,467,709 (91,128) |
| create entity + 2 comps | 1,852,299 (30,872) | 2,200,680 (36,678) | 2,519,483 (41,991) | 2,365,240 (39,421) |
| create entity + 4 comps | 1,166,906 (19,448) | 1,160,476 (19,341) | 1,226,342 (20,439) | 1,088,281 (18,138) |
| create entity + 8 comps | 617,548 (10,292) | 569,439 (9,491) | 645,177 (10,753) | 604,980 (10,083) |

### Entity — Destroy Throughput

Latency — avg (P99):

| Benchmark | xsmall | small | medium |
|-----------|-------:|------:|-------:|
| destroy empty entity | 285 ns (458 ns) | 225 ns (500 ns) | 213 ns (334 ns) |
| destroy entity + 2 comps | 404 ns (1.21 us) | 436 ns (1.17 us) | 602 ns (3.87 us) |
| destroy entity + 4 comps | 502 ns (1.33 us) | 407 ns (750 ns) | 450 ns (1.17 us) |
| destroy entity + 8 comps | 498 ns (1.05 us) | 506 ns (750 ns) | 602 ns (1.37 us) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium |
|-----------|-------:|------:|-------:|
| destroy empty entity | 3,509,441 (58,491) | 4,451,567 (74,193) | 4,696,898 (78,282) |
| destroy entity + 2 comps | 2,475,099 (41,252) | 2,291,486 (38,191) | 1,661,950 (27,699) |
| destroy entity + 4 comps | 1,992,211 (33,204) | 2,455,855 (40,931) | 2,224,358 (37,073) |
| destroy entity + 8 comps | 2,008,232 (33,471) | 1,974,681 (32,911) | 1,660,589 (27,676) |

### Entity — Create Memory

Per-operation retained memory delta (heap + external). 2,048 iterations, median of 8 samples.

| Benchmark | empty | xsmall | small | medium |
|-----------|------:|-------:|------:|-------:|
| create empty entity | +213 B | +208 B | +169 B | +96 B |
| create entity + 2 comps | +231 B | +222 B | +185 B | +115 B |
| create entity + 4 comps | +243 B | +244 B | +201 B | +131 B |
| create entity + 8 comps | +261 B | +256 B | +219 B | +149 B |

Total heap after 2,048 creates:

| Benchmark | empty | xsmall | small | medium |
|-----------|------:|-------:|------:|-------:|
| create empty entity | 9.4 MB | 10.9 MB | 21.8 MB | 128.1 MB |
| create entity + 2 comps | 9.6 MB | 11.1 MB | 22.0 MB | 128.2 MB |
| create entity + 4 comps | 9.8 MB | 11.3 MB | 22.1 MB | 128.4 MB |
| create entity + 8 comps | 10.0 MB | 11.4 MB | 22.3 MB | 128.5 MB |

### Entity — Destroy Memory

| Benchmark | xsmall | small | medium |
|-----------|-------:|------:|-------:|
| destroy empty entity | -77 B | -77 B | -77 B |
| destroy entity + 2 comps | -166 B | -166 B | -166 B |
| destroy entity + 4 comps | -255 B | -255 B | -255 B |
| destroy entity + 8 comps | -303 B | -303 B | -303 B |
