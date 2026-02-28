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

Query benchmarks iterate cached queries over existing preset worlds with natural archetype fragmentation. Three selectivity tiers target different match rates based on component overlap across templates:

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

Entities follow power-law weights within each group. Template-derived queries are pre-executed to populate internal caches -- each picks a random template and selects 1-3 of its types as terms, with a chance of adding a modifier (include or `not()`).

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

> Apple M4 (10-core), 24 GB RAM, macOS 26.2, Node.js v25.0.0
>
> Fixed 8,192 iterations per benchmark. `ops/frame` = operations per 16.67 ms frame at 60 fps.

### Entity Create

Create an entity and add each type in the template. Template selection is randomized (weighted distribution preserved).

Latency -- avg (P99):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|-------:|------:|-------:|------:|
| create empty entity | 168 ns (792 ns) | 134 ns (209 ns) | 120 ns (167 ns) | 142 ns (209 ns) | 141 ns (333 ns) |
| create entity + 2 types | 480 ns (1.17 us) | 437 ns (921 ns) | 402 ns (459 ns) | 431 ns (583 ns) | 484 ns (750 ns) |
| create entity + 4 types | 838 ns (1.42 us) | 817 ns (1.38 us) | 833 ns (1.50 us) | 811 ns (1.04 us) | 818 ns (1.08 us) |
| create entity + 8 types | 2.16 us (2.96 us) | 2.20 us (3.13 us) | 2.05 us (2.46 us) | 2.08 us (2.46 us) | 2.14 us (2.67 us) |

ops/sec (ops/frame):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|-------:|------:|-------:|------:|
| create empty entity | 5,952,627 (99,210) | 7,456,200 (124,270) | 8,305,015 (138,417) | 7,052,087 (117,535) | 7,081,647 (118,027) |
| create entity + 2 types | 2,085,143 (34,752) | 2,288,556 (38,143) | 2,486,338 (41,439) | 2,320,218 (38,670) | 2,066,957 (34,449) |
| create entity + 4 types | 1,192,962 (19,883) | 1,223,806 (20,397) | 1,200,648 (20,011) | 1,232,900 (20,548) | 1,222,099 (20,368) |
| create entity + 8 types | 463,964 (7,733) | 454,201 (7,570) | 487,033 (8,117) | 480,647 (8,011) | 467,563 (7,793) |

alloc/op (retained):

| Benchmark | empty | small | medium | large |
|-----------|------:|------:|-------:|------:|
| create empty entity | 508 B (+209 B) | 149 B (+209 B) | 248 B (+86 B) | 101 B (+94 B) |
| create entity + 2 types | 707 B (+246 B) | 475 B (+245 B) | 435 B (+303 B) | 282 B (-135 B) |
| create entity + 4 types | 630 B (+312 B) | 476 B (+318 B) | 491 B (+148 B) | 336 B (+110 B) |
| create entity + 8 types | 1.0 KB (+371 B) | 839 B (+373 B) | 744 B (+382 B) | 576 B (+90 B) |

### Entity Destroy

Destroy pre-created entities consumed from a pool (10,240 per benchmark). Each entity has a randomized template-based composition.

Latency -- avg (P99):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| destroy empty entity | 316 ns (583 ns) | 230 ns (334 ns) | 199 ns (292 ns) | 207 ns (334 ns) |
| destroy entity + 2 types | 510 ns (1.08 us) | 393 ns (1.08 us) | 296 ns (458 ns) | 398 ns (1.54 us) |
| destroy entity + 4 types | 448 ns (1.21 us) | 455 ns (1.29 us) | 395 ns (709 ns) | 421 ns (1.17 us) |
| destroy entity + 8 types | 713 ns (1.46 us) | 603 ns (1.50 us) | 514 ns (833 ns) | 535 ns (1,000 ns) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| destroy empty entity | 3,166,018 (52,767) | 4,356,789 (72,613) | 5,034,322 (83,905) | 4,824,624 (80,410) |
| destroy entity + 2 types | 1,959,887 (32,665) | 2,546,018 (42,434) | 3,374,144 (56,236) | 2,514,716 (41,912) |
| destroy entity + 4 types | 2,234,396 (37,240) | 2,199,086 (36,651) | 2,531,447 (42,191) | 2,372,951 (39,549) |
| destroy entity + 8 types | 1,403,178 (23,386) | 1,657,064 (27,618) | 1,945,291 (32,422) | 1,868,701 (31,145) |

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
|-----------|------:|-------:|------:|-------:|------:|
| add comp to empty entity | 189 ns (291 ns) | 176 ns (250 ns) | 181 ns (250 ns) | 173 ns (250 ns) | 166 ns (209 ns) |
| add comp to 2-type entity | 315 ns (588 ns) | 303 ns (541 ns) | 311 ns (583 ns) | 305 ns (542 ns) | 303 ns (546 ns) |
| add comp to 4-type entity | 432 ns (1.79 us) | 431 ns (1.92 us) | 425 ns (2.21 us) | 434 ns (2.80 us) | 430 ns (2.63 us) |
| add comp to 8-type entity | 634 ns (3.12 us) | 629 ns (3.05 us) | 614 ns (3.46 us) | 641 ns (4.38 us) | 1.73 us (6.17 us) |

ops/sec (ops/frame):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|-------:|------:|-------:|------:|
| add comp to empty entity | 5,294,367 (88,239) | 5,693,626 (94,894) | 5,511,410 (91,857) | 5,787,636 (96,461) | 6,011,096 (100,185) |
| add comp to 2-type entity | 3,171,948 (52,866) | 3,296,715 (54,945) | 3,212,841 (53,547) | 3,280,420 (54,674) | 3,304,084 (55,068) |
| add comp to 4-type entity | 2,313,111 (38,552) | 2,318,349 (38,639) | 2,352,704 (39,212) | 2,301,770 (38,363) | 2,324,142 (38,736) |
| add comp to 8-type entity | 1,576,888 (26,281) | 1,588,976 (26,483) | 1,627,887 (27,131) | 1,559,389 (25,990) | 578,976 (9,650) |

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
|-----------|-------:|------:|-------:|------:|
| remove comp from 2-type entity | 220 ns (375 ns) | 197 ns (333 ns) | 206 ns (375 ns) | 204 ns (375 ns) |
| remove comp from 4-type entity | 330 ns (921 ns) | 309 ns (875 ns) | 318 ns (1.08 us) | 313 ns (833 ns) |
| remove comp from 8-type entity | 541 ns (3.84 us) | 539 ns (3.97 us) | 541 ns (4.46 us) | 547 ns (4.87 us) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| remove comp from 2-type entity | 4,542,972 (75,716) | 5,068,874 (84,481) | 4,852,799 (80,880) | 4,904,561 (81,743) |
| remove comp from 4-type entity | 3,034,653 (50,578) | 3,231,172 (53,853) | 3,141,236 (52,354) | 3,194,199 (53,237) |
| remove comp from 8-type entity | 1,848,987 (30,816) | 1,855,152 (30,919) | 1,849,699 (30,828) | 1,829,171 (30,486) |

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
|-----------|------:|-------:|------:|-------:|------:|
| hasComponent | 63 ns (125 ns) | 69 ns (125 ns) | 66 ns (125 ns) | 47 ns (84 ns) | 42 ns (125 ns) |
| getComponentValue | 67 ns (125 ns) | 67 ns (125 ns) | 66 ns (125 ns) | 60 ns (125 ns) | 62 ns (167 ns) |
| setComponentValue | 110 ns (167 ns) | 109 ns (167 ns) | 109 ns (167 ns) | 112 ns (167 ns) | 105 ns (167 ns) |

ops/sec (ops/frame):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|-------:|------:|-------:|------:|
| hasComponent | 15,995,283 (266,588) | 14,418,347 (240,306) | 15,140,090 (252,335) | 21,197,153 (353,286) | 23,618,006 (393,633) |
| getComponentValue | 14,844,183 (247,403) | 14,847,869 (247,464) | 15,092,977 (251,550) | 16,533,196 (275,553) | 16,133,320 (268,889) |
| setComponentValue | 9,062,759 (151,046) | 9,174,682 (152,911) | 9,204,805 (153,413) | 8,893,337 (148,222) | 9,526,180 (158,770) |

alloc/op (retained):

| Benchmark | empty | small | medium | large |
|-----------|------:|------:|-------:|------:|
| hasComponent | 144 B (+0 B) | 0 B (+0 B) | 0 B (+0 B) | 0 B (+0 B) |
| getComponentValue | 144 B (+0 B) | 0 B (+0 B) | 0 B (+0 B) | 0 B (+0 B) |
| setComponentValue | 208 B (+0 B) | 64 B (+0 B) | 64 B (+0 B) | 64 B (+0 B) |

### Query Iteration

Iterate all matching entities through a pre-cached query. Pure iteration with no component access. `ent/sec` = ops/sec x matching entity count.

Latency -- avg (P99):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| iter all | 580 ns (750 ns) | 5.02 us (5.87 us) | 45.79 us (51.17 us) | 452.38 us (557.75 us) |
| iter selective | 289 ns (375 ns) | 2.18 us (2.46 us) | 19.35 us (21.96 us) | 206.99 us (258.28 us) |
| iter narrow | -- | 254 ns (292 ns) | 2.40 us (2.58 us) | 33.50 us (39.30 us) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| iter all | 1,724,460 (28,741) | 199,063 (3,318) | 21,837 (364) | 2,211 (37) |
| iter selective | 3,461,133 (57,686) | 458,360 (7,639) | 51,673 (861) | 4,831 (81) |
| iter narrow | -- | 3,932,076 (65,535) | 417,237 (6,954) | 29,849 (497) |

ent/sec (ent/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| iter all | 172.4 M (2,874,100) | 199.1 M (3,317,720) | 218.4 M (3,639,459) | 221.1 M (3,684,180) |
| iter selective | 166.1 M (2,768,906) | 203.1 M (3,384,228) | 224.1 M (3,734,250) | 216.7 M (3,611,144) |
| iter narrow | -- | 180.9 M (3,014,591) | 209.9 M (3,497,838) | 216.5 M (3,608,803) |

alloc/op (retained):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| iter all | 4.6 KB (+0 B) | 39.8 KB (-8 B) | 391.4 KB (-9 B) | 3.8 MB (-0 B) |
| iter selective | 2.6 KB (-8 B) | 18.0 KB (-8 B) | 170.1 KB (-8 B) | 1.7 MB (-0 B) |
| iter narrow | -- | 2.5 KB (-8 B) | 20.2 KB (-0 B) | 284.0 KB (-0 B) |
