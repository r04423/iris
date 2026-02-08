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
      presets: ["empty", "xsmall", "small"],
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

| Benchmark | empty | xsmall | small |
|-----------|------:|-------:|------:|
| create empty entity | 152 ns (209 ns) | 138 ns (583 ns) | 128 ns (333 ns) |
| create entity + 2 comps | 535 ns (1.33 us) | 559 ns (837 ns) | 385 ns (459 ns) |
| create entity + 4 comps | 825 ns (917 ns) | 853 ns (1.75 us) | 806 ns (963 ns) |
| create entity + 8 comps | 1.64 us (4.33 us) | 1.72 us (2.33 us) | 1.56 us (1.92 us) |

ops/sec (ops/frame):

| Benchmark | empty | xsmall | small |
|-----------|------:|-------:|------:|
| create empty entity | 6,567,571 (109,460) | 7,235,605 (120,593) | 7,842,634 (130,711) |
| create entity + 2 comps | 1,867,678 (31,128) | 1,790,090 (29,835) | 2,595,912 (43,265) |
| create entity + 4 comps | 1,211,895 (20,198) | 1,172,278 (19,538) | 1,241,302 (20,688) |
| create entity + 8 comps | 609,442 (10,157) | 581,359 (9,689) | 639,663 (10,661) |

### Entity — Destroy Throughput

Latency — avg (P99):

| Benchmark | xsmall | small |
|-----------|-------:|------:|
| destroy empty entity | 273 ns (417 ns) | 214 ns (333 ns) |
| destroy entity + 2 comps | 384 ns (1.00 us) | 331 ns (917 ns) |
| destroy entity + 4 comps | 472 ns (1.21 us) | 423 ns (666 ns) |
| destroy entity + 8 comps | 454 ns (667 ns) | 496 ns (667 ns) |

ops/sec (ops/frame):

| Benchmark | xsmall | small |
|-----------|-------:|------:|
| destroy empty entity | 3,659,471 (60,991) | 4,675,012 (77,917) |
| destroy entity + 2 comps | 2,603,021 (43,384) | 3,023,907 (50,398) |
| destroy entity + 4 comps | 2,120,043 (35,334) | 2,362,724 (39,379) |
| destroy entity + 8 comps | 2,201,790 (36,697) | 2,016,096 (33,602) |

### Entity — Create Memory

Per-operation retained memory delta (heap + external). 2,048 iterations, median of 8 samples.

| Benchmark | empty | xsmall | small |
|-----------|------:|-------:|------:|
| create empty entity | +211 B | +208 B | +169 B |
| create entity + 2 comps | +227 B | +222 B | +185 B |
| create entity + 4 comps | +243 B | +244 B | +201 B |
| create entity + 8 comps | +261 B | +256 B | +219 B |

Total heap after 2,048 creates:

| Benchmark | empty | xsmall | small |
|-----------|------:|-------:|------:|
| create empty entity | 9.2 MB | 10.7 MB | 21.7 MB |
| create entity + 2 comps | 9.5 MB | 10.9 MB | 21.8 MB |
| create entity + 4 comps | 9.7 MB | 11.1 MB | 22.0 MB |
| create entity + 8 comps | 9.8 MB | 11.3 MB | 22.1 MB |

### Entity — Destroy Memory

| Benchmark | xsmall | small |
|-----------|-------:|------:|
| destroy empty entity | -77 B | -77 B |
| destroy entity + 2 comps | -166 B | -166 B |
| destroy entity + 4 comps | -255 B | -255 B |
| destroy entity + 8 comps | -303 B | -303 B |
