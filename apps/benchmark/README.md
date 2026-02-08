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

### Throughput — Entity (empty world)

| Benchmark | ops/sec | ops/frame | avg | P75 | P99 |
|-----------|--------:|----------:|----:|----:|----:|
| create empty entity | 6,121,706 | 102,028 | 163 ns | 125 ns | 291 ns |
| create entity + 2 comps | 1,681,567 | 28,026 | 595 ns | 500 ns | 1.37 us |
| create entity + 4 comps | 1,258,827 | 20,980 | 794 ns | 791 ns | 959 ns |
| create entity + 8 comps | 626,593 | 10,443 | 1.60 us | 1.54 us | 1.79 us |

### Throughput — Entity (xsmall world)

| Benchmark | ops/sec | ops/frame | avg | P75 | P99 |
|-----------|--------:|----------:|----:|----:|----:|
| create empty entity | 6,672,020 | 111,200 | 150 ns | 125 ns | 666 ns |
| create entity + 2 comps | 2,168,445 | 36,141 | 461 ns | 417 ns | 1.33 us |
| create entity + 4 comps | 1,164,364 | 19,406 | 859 ns | 792 ns | 1.79 us |
| create entity + 8 comps | 590,917 | 9,849 | 1.69 us | 1.50 us | 2.38 us |
| destroy empty entity | 3,781,516 | 63,025 | 264 ns | 291 ns | 417 ns |
| destroy entity + 2 comps | 1,721,735 | 28,696 | 581 ns | 416 ns | 1.21 us |
| destroy entity + 4 comps | 1,878,456 | 31,308 | 532 ns | 458 ns | 1.29 us |
| destroy entity + 8 comps | 2,074,065 | 34,568 | 482 ns | 500 ns | 1.00 us |

### Throughput — Entity (small world)

| Benchmark | ops/sec | ops/frame | avg | P75 | P99 |
|-----------|--------:|----------:|----:|----:|----:|
| create empty entity | 7,273,450 | 121,224 | 137 ns | 125 ns | 379 ns |
| create entity + 2 comps | 2,552,116 | 42,535 | 392 ns | 375 ns | 500 ns |
| create entity + 4 comps | 1,238,531 | 20,642 | 807 ns | 791 ns | 958 ns |
| create entity + 8 comps | 655,413 | 10,924 | 1.53 us | 1.50 us | 1.71 us |
| destroy empty entity | 4,568,950 | 76,149 | 219 ns | 250 ns | 333 ns |
| destroy entity + 2 comps | 2,436,010 | 40,600 | 411 ns | 375 ns | 1.13 us |
| destroy entity + 4 comps | 2,421,655 | 40,361 | 413 ns | 417 ns | 667 ns |
| destroy entity + 8 comps | 1,951,845 | 32,531 | 512 ns | 500 ns | 1.25 us |

### Memory — Entity (empty world)

Per-operation retained memory delta (heap + external). 2,048 iterations, median of 8 samples.

| Benchmark | delta/op | total delta | total mem |
|-----------|:--------:|:----------:|----------:|
| create empty entity | +212 B | +423.3 KB | 9.2 MB |
| create entity + 2 comps | +227 B | +453.9 KB | 9.5 MB |
| create entity + 4 comps | +243 B | +485.4 KB | 9.7 MB |
| create entity + 8 comps | +261 B | +521.7 KB | 9.8 MB |

### Memory — Entity (xsmall world)

| Benchmark | delta/op | total delta | total mem |
|-----------|:--------:|:----------:|----------:|
| create empty entity | +208 B | +416.3 KB | 10.8 MB |
| create entity + 2 comps | +222 B | +443.8 KB | 10.9 MB |
| create entity + 4 comps | +244 B | +487.3 KB | 11.1 MB |
| create entity + 8 comps | +256 B | +511.8 KB | 11.3 MB |
| destroy empty entity | -77 B | -153.1 KB | 12.3 MB |
| destroy entity + 2 comps | -166 B | -331.3 KB | 13.0 MB |
| destroy entity + 4 comps | -255 B | -509.4 KB | 13.7 MB |
| destroy entity + 8 comps | -303 B | -606.0 KB | 14.7 MB |

### Memory — Entity (small world)

| Benchmark | delta/op | total delta | total mem |
|-----------|:--------:|:----------:|----------:|
| create empty entity | +169 B | +337.2 KB | 21.7 MB |
| create entity + 2 comps | +185 B | +370.3 KB | 21.8 MB |
| create entity + 4 comps | +201 B | +401.7 KB | 22.0 MB |
| create entity + 8 comps | +219 B | +438.3 KB | 22.1 MB |
| destroy empty entity | -77 B | -153.1 KB | 23.1 MB |
| destroy entity + 2 comps | -166 B | -331.3 KB | 23.7 MB |
| destroy entity + 4 comps | -254 B | -507.3 KB | 24.5 MB |
| destroy entity + 8 comps | -303 B | -606.0 KB | 25.5 MB |
