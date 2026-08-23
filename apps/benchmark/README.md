# iris-benchmark

Performance benchmark harness for `iris-ecs`, built on [tinybench](https://github.com/tinylibs/tinybench).

Use this to detect regressions, compare optimization strategies, and validate performance claims. Results are machine-sensitive -- use for local iteration and relative comparisons on the same hardware.

## Modes

The harness supports two measurement modes:

**Throughput** (default) runs each benchmark for a fixed number of iterations and reports `ops/sec`, `avg`, `P75`, and `P99` latency. Query benchmarks additionally report `ent/sec` and `ent/frame` (entity throughput scaled by matching entity count).

**Memory** (`--memory`) samples heap before/after each iteration to measure allocation rate, then runs a second GC-fenced pass to measure retention. Multiple independent samples per benchmark, median reported.

| Metric | Description |
|--------|-------------|
| `alloc/op` | Average bytes allocated per operation (positive deltas only) |
| `min` | Smallest single-operation allocation |
| `max` | Largest single-operation allocation (resize spikes show up here) |
| `retained` | Net delta after GC, per operation (leak indicator) |
| `distribution` | Allocation size histogram: `▁▂▃▄▅▆▇█` |

## Methodology

### Templates

14 templates across 3 width groups (2/4/8 types) with power-law weights -- "hot" templates (Particle, Prop, Enemy) spawn far more often than "cold" ones (Player, Waypoint). All templates share C[0]; several share C[1].

### Type fragmentation

Presets apply **modifiers** -- optional types from a pool of 20 (10 components, 10 tags) -- to a fraction of entities during population, creating a long tail of composition variants beyond the 14 base templates. Per-entity, a seeded RNG decides whether to apply modifiers (per-preset rate), how many (75%/20%/5% for 1/2/3), and which ones (uniform random, sorted for deterministic identity). Modifiers only apply during preset population -- benchmark operations use pure templates.

### Randomized selection and targets

Template selection uses seeded RNG over the weighted cycle (preserving distribution, randomizing order). Per-assignment targets are also randomized: **add** picks from C[95..99] (none in any template), **remove** and **has** pick a random type from the template, **get/set** pick a random component.

### Query iteration

Query benchmarks iterate warm term queries over existing preset worlds with natural archetype fragmentation. Three selectivity tiers target different match rates based on component overlap across templates:

| Query | Match rate | Description |
|-------|-----------|-------------|
| iter all | 100% | Matches every entity across all archetypes |
| iter selective | ~45% | Matches 5 of 14 templates (multi-group) |
| iter narrow | ~7% | Matches 2 templates in a single group |

## Presets

Each benchmark runs against one or more **world presets** -- pre-populated worlds of varying size:

| Preset | Entities | Group 2 | Group 4 | Group 8 | ~Compositions | Queries |
|--------|----------|---------|---------|---------|-------------|---------|
| empty  | 0        | --      | --      | --      | 0           | 0       |
| xsmall | 100      | 60%     | 30%     | 10%     | ~38         | 20      |
| small  | 1,000    | 50%     | 35%     | 15%     | ~132        | 100     |
| medium | 10,000   | 40%     | 40%     | 20%     | ~213        | 400     |
| large  | 100,000  | 30%     | 40%     | 30%     | ~229        | 1,000   |

Entities follow power-law weights within each group. Template-derived terms are executed once to populate internal caches -- each picks a random template and selects 1-3 of its types, with a chance of adding a modifier (include or `not()`).

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
pnpm typecheck               # typecheck benchmark code
```

## Adding a Suite

1. Create a file in `src/libs/iris/suites/` that exports a `suite` object:

```typescript
import type { Suite } from "../../../types.js";

export const suite: Suite = {
  name: "MyFeature",
  benchmarks: [
    {
      name: "some operation",
      presets: ["empty", "xsmall", "small", "medium", "large"],
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

> Apple M4 (10-core), 24 GB RAM, macOS 26.5, Node.js v26.5.0.
>
> Fixed 8,192 iterations per benchmark. `ops/frame` = operations per 16.67 ms frame at 60 fps.

### Entity Create

Create an entity and add every type in the template through a single `addComponents` batch. Template selection is randomized (weighted distribution preserved). The entries array is built per operation -- it is part of the real spawn cost.

Latency -- avg (P99):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|------:|------:|------:|------:|
| create empty entity | 114 ns (833 ns) | 55 ns (125 ns) | 62 ns (166 ns) | 54 ns (84 ns) | 45 ns (84 ns) |
| create entity + 2 types | 412 ns (1.62 us) | 248 ns (588 ns) | 249 ns (500 ns) | 248 ns (292 ns) | 239 ns (292 ns) |
| create entity + 4 types | 415 ns (1.13 us) | 426 ns (1.04 us) | 459 ns (1.04 us) | 362 ns (458 ns) | 370 ns (625 ns) |
| create entity + 8 types | 667 ns (1.42 us) | 679 ns (1.33 us) | 640 ns (1.17 us) | 638 ns (833 ns) | 653 ns (833 ns) |

ops/sec (ops/frame):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|------:|------:|------:|------:|
| create empty entity | 8,752,240 (145,871) | 18,024,520 (300,409) | 16,155,529 (269,259) | 18,445,673 (307,428) | 22,321,404 (372,023) |
| create entity + 2 types | 2,428,444 (40,474) | 4,024,805 (67,080) | 4,010,924 (66,849) | 4,038,665 (67,311) | 4,179,824 (69,664) |
| create entity + 4 types | 2,412,271 (40,205) | 2,349,917 (39,165) | 2,178,030 (36,301) | 2,763,168 (46,053) | 2,703,685 (45,061) |
| create entity + 8 types | 1,498,460 (24,974) | 1,472,360 (24,539) | 1,563,008 (26,050) | 1,566,403 (26,107) | 1,530,555 (25,509) |

alloc/op (retained):

| Benchmark | empty | small | medium | large |
|-----------|------:|------:|-------:|------:|
| create empty entity | 382 B (+117 B) | 144 B (+120 B) | 117 B (+102 B) | 109 B (+102 B) |
| create entity + 2 types | 1,018 B (+183 B) | 663 B (+184 B) | 595 B (+469 B) | 549 B (-288 B) |
| create entity + 4 types | 948 B (+294 B) | 746 B (+313 B) | 600 B (+212 B) | 583 B (+118 B) |
| create entity + 8 types | 1.3 KB (+395 B) | 1.1 KB (+412 B) | 853 B (+614 B) | 824 B (+98 B) |

### Entity Destroy

Destroy pre-created entities consumed from a pool (10,240 per benchmark). Each entity has a randomized template-based composition.

Latency -- avg (P99):

| Benchmark | xsmall | small | medium | large |
|-----------|------:|------:|------:|------:|
| destroy empty entity | 160 ns (421 ns) | 106 ns (166 ns) | 108 ns (125 ns) | 113 ns (208 ns) |
| destroy entity + 2 types | 305 ns (1.13 us) | 237 ns (958 ns) | 215 ns (334 ns) | 285 ns (1.25 us) |
| destroy entity + 4 types | 339 ns (1.17 us) | 346 ns (1.21 us) | 298 ns (459 ns) | 309 ns (629 ns) |
| destroy entity + 8 types | 572 ns (1.54 us) | 499 ns (1.50 us) | 464 ns (1.00 us) | 447 ns (833 ns) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|------:|------:|------:|------:|
| destroy empty entity | 6,258,107 (104,302) | 9,414,274 (156,905) | 9,281,931 (154,699) | 8,869,746 (147,829) |
| destroy entity + 2 types | 3,280,634 (54,677) | 4,223,262 (70,388) | 4,642,728 (77,379) | 3,514,699 (58,578) |
| destroy entity + 4 types | 2,946,416 (49,107) | 2,890,649 (48,177) | 3,356,380 (55,940) | 3,237,832 (53,964) |
| destroy entity + 8 types | 1,747,422 (29,124) | 2,004,021 (33,400) | 2,156,658 (35,944) | 2,236,022 (37,267) |

alloc/op (retained):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| destroy empty entity | 318 B (-79 B) | 285 B (-82 B) | 262 B (-81 B) | 262 B (-82 B) |
| destroy entity + 2 types | 557 B (+82 B) | 637 B (+72 B) | 649 B (+73 B) | 637 B (+73 B) |
| destroy entity + 4 types | 892 B (+255 B) | 1.0 KB (+233 B) | 977 B (+238 B) | 945 B (+227 B) |
| destroy entity + 8 types | 1.6 KB (+566 B) | 1.8 KB (+558 B) | 1.7 KB (+566 B) | 1.8 KB (+571 B) |

### Component Add

Add a component with a randomized target from C[95..99] (none in any template). Entities have randomized template-based compositions.

Latency -- avg (P99):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|------:|------:|------:|------:|
| add comp to empty entity | 101 ns (125 ns) | 100 ns (125 ns) | 107 ns (125 ns) | 103 ns (125 ns) | 102 ns (125 ns) |
| add comp to 2-type entity | 254 ns (591 ns) | 239 ns (541 ns) | 240 ns (541 ns) | 239 ns (667 ns) | 236 ns (500 ns) |
| add comp to 4-type entity | 368 ns (2.42 us) | 358 ns (2.25 us) | 340 ns (2.08 us) | 342 ns (2.17 us) | 356 ns (2.25 us) |
| add comp to 8-type entity | 1.06 us (4.42 us) | 583 ns (4.05 us) | 552 ns (3.59 us) | 552 ns (3.71 us) | 1.65 us (4.54 us) |

ops/sec (ops/frame):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|------:|------:|------:|------:|
| add comp to empty entity | 9,898,370 (164,973) | 9,975,803 (166,263) | 9,303,963 (155,066) | 9,738,619 (162,310) | 9,802,819 (163,380) |
| add comp to 2-type entity | 3,939,789 (65,663) | 4,181,047 (69,684) | 4,162,786 (69,380) | 4,191,210 (69,853) | 4,233,684 (70,561) |
| add comp to 4-type entity | 2,719,300 (45,322) | 2,790,611 (46,510) | 2,939,402 (48,990) | 2,921,574 (48,693) | 2,805,833 (46,764) |
| add comp to 8-type entity | 940,519 (15,675) | 1,715,582 (28,593) | 1,811,716 (30,195) | 1,811,274 (30,188) | 605,524 (10,092) |

alloc/op (retained):

| Benchmark | empty | small | medium | large |
|-----------|------:|------:|-------:|------:|
| add comp to empty entity | 230 B (+94 B) | 195 B (+94 B) | 118 B (+94 B) | 102 B (+94 B) |
| add comp to 2-type entity | 237 B (+102 B) | 240 B (+102 B) | 239 B (+102 B) | 239 B (+102 B) |
| add comp to 4-type entity | 358 B (+204 B) | 362 B (+204 B) | 363 B (+205 B) | 361 B (+204 B) |
| add comp to 8-type entity | 584 B (+259 B) | 589 B (+259 B) | 591 B (+259 B) | 591 B (+259 B) |

### Component Remove

Remove a randomized type from each template. Entities consumed from a pool (10,240 per benchmark).

Latency -- avg (P99):

| Benchmark | xsmall | small | medium | large |
|-----------|------:|------:|------:|------:|
| remove comp from 2-type entity | 208 ns (379 ns) | 235 ns (834 ns) | 223 ns (875 ns) | 184 ns (333 ns) |
| remove comp from 4-type entity | 335 ns (875 ns) | 323 ns (1.25 us) | 305 ns (962 ns) | 438 ns (1.37 us) |
| remove comp from 8-type entity | 592 ns (4.29 us) | 558 ns (3.67 us) | 567 ns (3.62 us) | 567 ns (3.88 us) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|------:|------:|------:|------:|
| remove comp from 2-type entity | 4,799,752 (79,996) | 4,250,486 (70,841) | 4,479,746 (74,662) | 5,427,520 (90,459) |
| remove comp from 4-type entity | 2,987,382 (49,790) | 3,099,302 (51,655) | 3,284,055 (54,734) | 2,282,349 (38,039) |
| remove comp from 8-type entity | 1,688,034 (28,134) | 1,792,256 (29,871) | 1,765,115 (29,419) | 1,762,803 (29,380) |

alloc/op (retained):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| remove comp from 2-type entity | 313 B (+110 B) | 255 B (+110 B) | 256 B (+110 B) | 256 B (+110 B) |
| remove comp from 4-type entity | 290 B (+172 B) | 252 B (+172 B) | 294 B (+172 B) | 249 B (+172 B) |
| remove comp from 8-type entity | 574 B (+198 B) | 537 B (+198 B) | 589 B (+198 B) | 542 B (+198 B) |

### Component Access

Has, get, and set operations on a pool of entities with group 4 templates (4 types each). Each iteration targets a randomized entity with a randomized target component, cycling through the pool.

Latency -- avg (P99):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|------:|------:|------:|------:|
| hasComponent | 29 ns (42 ns) | 30 ns (83 ns) | 36 ns (83 ns) | 26 ns (42 ns) | 28 ns (42 ns) |
| getComponentValue | 34 ns (84 ns) | 42 ns (84 ns) | 48 ns (84 ns) | 39 ns (84 ns) | 44 ns (84 ns) |
| setComponentValue | 61 ns (84 ns) | 66 ns (84 ns) | 65 ns (84 ns) | 54 ns (84 ns) | 55 ns (84 ns) |

ops/sec (ops/frame):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|------:|------:|------:|------:|
| hasComponent | 34,832,153 (580,536) | 33,567,167 (559,453) | 27,708,626 (461,810) | 38,812,136 (646,869) | 36,281,340 (604,689) |
| getComponentValue | 29,096,695 (484,945) | 23,817,415 (396,957) | 20,809,994 (346,833) | 25,552,727 (425,879) | 22,565,566 (376,093) |
| setComponentValue | 16,335,256 (272,254) | 15,043,476 (250,725) | 15,354,511 (255,909) | 18,474,876 (307,915) | 18,035,194 (300,587) |

alloc/op (retained):

| Benchmark | empty | small | medium | large |
|-----------|------:|------:|-------:|------:|
| hasComponent | 144 B (+0 B) | 0 B (+0 B) | 0 B (+0 B) | 0 B (+0 B) |
| getComponentValue | 144 B (+0 B) | 0 B (+0 B) | 0 B (+0 B) | 0 B (+0 B) |
| setComponentValue | 208 B (+0 B) | 64 B (+0 B) | 64 B (+0 B) | 64 B (+0 B) |

### Query Iteration

Iterate all matching entities through warm terms. `ent/sec` = ops/sec x matching entity count.

> **Experimental traversal APIs:** The callback and column results below measure the traversal performance of `EXPERIMENTAL_queryEntities` and `EXPERIMENTAL_queryColumns`. These APIs are experimental, not part of the stable public API, and may change or be removed. The benchmark labels retain their original names so historical results remain comparable.

Latency -- avg (P99):

| Benchmark | xsmall | small | medium | large |
|-----------|------:|------:|------:|------:|
| iter all | 576 ns (667 ns) | 4.90 us (5.75 us) | 44.17 us (53.59 us) | 428.99 us (501.06 us) |
| iter selective | 352 ns (375 ns) | 2.25 us (2.71 us) | 20.22 us (24.34 us) | 197.12 us (254.31 us) |
| iter narrow | -- | 258 ns (334 ns) | 2.43 us (2.96 us) | 33.02 us (39.89 us) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|------:|------:|------:|------:|
| iter all | 1,735,590 (28,926) | 204,023 (3,400) | 22,642 (377) | 2,331 (39) |
| iter selective | 2,840,673 (47,345) | 444,510 (7,408) | 49,464 (824) | 5,073 (85) |
| iter narrow | -- | 3,872,129 (64,535) | 411,644 (6,861) | 30,288 (505) |

ent/sec (ent/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|------:|------:|------:|------:|
| iter all | 173.6 M (2,892,650) | 204.0 M (3,400,378) | 226.4 M (3,773,676) | 233.1 M (3,885,079) |
| iter selective | 136.4 M (2,272,538) | 196.9 M (3,281,965) | 214.5 M (3,574,587) | 227.5 M (3,791,984) |
| iter narrow | -- | 178.1 M (2,968,632) | 207.1 M (3,450,950) | 219.7 M (3,661,853) |

alloc/op (retained):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| iter all | 4.6 KB (+0 B) | 39.8 KB (-8 B) | 391.4 KB (-9 B) | 3.8 MB (-0 B) |
| iter selective | 2.6 KB (-8 B) | 18.0 KB (-8 B) | 170.1 KB (-8 B) | 1.7 MB (-0 B) |
| iter narrow | -- | 2.5 KB (-8 B) | 20.2 KB (-0 B) | 284.0 KB (-0 B) |

**Experimental column callback** -- `EXPERIMENTAL_queryColumns` calls the callback once per archetype with direct column access. Pure iteration with no data access.

Latency -- avg (P99):

| Benchmark | xsmall | small | medium | large |
|-----------|------:|------:|------:|------:|
| columns iter all | 1.23 us (1.54 us) | 8.41 us (10.09 us) | 68.89 us (84.76 us) | 621.79 us (721.80 us) |
| columns iter selective | 555 ns (708 ns) | 3.65 us (4.46 us) | 29.36 us (36.42 us) | 279.59 us (344.86 us) |
| columns iter narrow | -- | 331 ns (417 ns) | 3.38 us (4.17 us) | 45.21 us (57.04 us) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|------:|------:|------:|------:|
| columns iter all | 816,212 (13,604) | 118,967 (1,983) | 14,515 (242) | 1,608 (27) |
| columns iter selective | 1,801,625 (30,027) | 274,056 (4,568) | 34,057 (568) | 3,577 (60) |
| columns iter narrow | -- | 3,023,986 (50,400) | 295,965 (4,933) | 22,120 (369) |

ent/sec (ent/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|------:|------:|------:|------:|
| columns iter all | 81.6 M (1,360,353) | 119.0 M (1,982,786) | 145.1 M (2,419,153) | 160.8 M (2,680,413) |
| columns iter selective | 86.5 M (1,441,300) | 121.4 M (2,023,449) | 147.7 M (2,461,185) | 160.4 M (2,673,403) |
| columns iter narrow | -- | 139.1 M (2,318,389) | 148.9 M (2,481,171) | 160.5 M (2,674,317) |

**Experimental traversal data access** -- Increment a scalar component field on every matching entity. Compares per-entity `getComponentValue`/`setComponentValue` through `EXPERIMENTAL_queryEntities` against direct TypedArray mutation via `EXPERIMENTAL_queryColumns`.

Latency -- avg (P99):

| Benchmark | xsmall | small | medium | large |
|-----------|------:|------:|------:|------:|
| increment via entities | 4.70 us (5.75 us) | 47.22 us (54.67 us) | 442.07 us (483.27 us) | 4.37 ms (5.25 ms) |
| increment via columns | 940 ns (1.25 us) | 3.63 us (4.00 us) | 17.66 us (25.17 us) | 95.75 us (103.26 us) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|------:|------:|------:|------:|
| increment via entities | 212,806 (3,547) | 21,176 (353) | 2,262 (38) | 229 (4) |
| increment via columns | 1,063,857 (17,731) | 275,371 (4,590) | 56,612 (944) | 10,443 (174) |

ent/sec (ent/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|------:|------:|------:|------:|
| increment via entities | 21.3 M (354,676) | 21.2 M (352,941) | 22.6 M (377,014) | 22.9 M (380,971) |
| increment via columns | 106.4 M (1,773,094) | 275.4 M (4,589,525) | 566.1 M (9,435,300) | 1.0 B (17,405,532) |
