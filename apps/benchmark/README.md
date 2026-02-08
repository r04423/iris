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
| xsmall | 100      | 20              | 20        | 20             |
| small  | 1,000    | 100             | 100       | 100            |

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
