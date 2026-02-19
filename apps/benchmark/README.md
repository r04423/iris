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
| create empty entity | 235 ns (959 ns) | 154 ns (667 ns) | 133 ns (167 ns) | 615 ns (667 ns) | 146 ns (375 ns) |
| create entity + 2 types | 473 ns (1.25 us) | 490 ns (1.42 us) | 430 ns (713 ns) | 453 ns (542 ns) | 483 ns (750 ns) |
| create entity + 4 types | 867 ns (1.83 us) | 812 ns (1.38 us) | 818 ns (1.50 us) | 825 ns (1.00 us) | 846 ns (1.08 us) |
| create entity + 8 types | 2.17 us (3.46 us) | 2.20 us (3.46 us) | 2.15 us (3.17 us) | 2.19 us (2.62 us) | 2.15 us (2.62 us) |

ops/sec (ops/frame):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|-------:|------:|-------:|------:|
| create empty entity | 4,263,693 (71,062) | 6,484,111 (108,069) | 7,529,087 (125,485) | 1,626,014 (27,100) | 6,844,439 (114,074) |
| create entity + 2 types | 2,115,417 (35,257) | 2,042,099 (34,035) | 2,323,754 (38,729) | 2,205,184 (36,753) | 2,069,754 (34,496) |
| create entity + 4 types | 1,153,444 (19,224) | 1,231,389 (20,523) | 1,222,948 (20,382) | 1,212,066 (20,201) | 1,182,646 (19,711) |
| create entity + 8 types | 459,950 (7,666) | 454,127 (7,569) | 465,611 (7,760) | 457,407 (7,623) | 465,054 (7,751) |

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
| destroy empty entity | 291 ns (500 ns) | 238 ns (375 ns) | 203 ns (333 ns) | 223 ns (417 ns) |
| destroy entity + 2 types | 424 ns (1.25 us) | 338 ns (1.04 us) | 303 ns (458 ns) | 361 ns (1.05 us) |
| destroy entity + 4 types | 472 ns (1.50 us) | 455 ns (1.33 us) | 418 ns (1.25 us) | 557 ns (1.17 us) |
| destroy entity + 8 types | 672 ns (1.75 us) | 660 ns (1.84 us) | 569 ns (1.46 us) | 683 ns (1.29 us) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| destroy empty entity | 3,440,594 (57,343) | 4,201,918 (70,032) | 4,918,758 (81,979) | 4,489,488 (74,825) |
| destroy entity + 2 types | 2,357,720 (39,295) | 2,957,832 (49,297) | 3,300,198 (55,003) | 2,772,078 (46,201) |
| destroy entity + 4 types | 2,120,107 (35,335) | 2,198,957 (36,649) | 2,391,586 (39,860) | 1,794,815 (29,914) |
| destroy entity + 8 types | 1,486,996 (24,783) | 1,515,342 (25,256) | 1,757,108 (29,285) | 1,464,532 (24,409) |

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
| add comp to empty entity | 188 ns (292 ns) | 194 ns (333 ns) | 197 ns (292 ns) | 188 ns (333 ns) | 210 ns (375 ns) |
| add comp to 2-type entity | 318 ns (588 ns) | 335 ns (833 ns) | 318 ns (625 ns) | 363 ns (879 ns) | 387 ns (1.04 us) |
| add comp to 4-type entity | 488 ns (2.68 us) | 468 ns (2.80 us) | 491 ns (3.34 us) | 473 ns (3.13 us) | 540 ns (3.33 us) |
| add comp to 8-type entity | 657 ns (3.12 us) | 1.65 us (4.46 us) | 722 ns (5.71 us) | 691 ns (5.47 us) | 1.93 us (9.22 us) |

ops/sec (ops/frame):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|-------:|------:|-------:|------:|
| add comp to empty entity | 5,317,243 (88,621) | 5,164,863 (86,081) | 5,072,047 (84,534) | 5,305,858 (88,431) | 4,763,646 (79,394) |
| add comp to 2-type entity | 3,148,309 (52,472) | 2,983,315 (49,722) | 3,144,261 (52,404) | 2,754,136 (45,902) | 2,586,726 (43,112) |
| add comp to 4-type entity | 2,047,771 (34,130) | 2,136,724 (35,612) | 2,038,734 (33,979) | 2,112,921 (35,215) | 1,850,523 (30,842) |
| add comp to 8-type entity | 1,521,991 (25,367) | 606,018 (10,100) | 1,385,927 (23,099) | 1,446,693 (24,112) | 516,900 (8,615) |

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
| remove comp from 2-type entity | 259 ns (708 ns) | 276 ns (917 ns) | 231 ns (459 ns) | 230 ns (417 ns) |
| remove comp from 4-type entity | 395 ns (1.71 us) | 370 ns (1.38 us) | 361 ns (1.09 us) | 378 ns (1.34 us) |
| remove comp from 8-type entity | 598 ns (4.29 us) | 611 ns (4.63 us) | 588 ns (4.71 us) | 775 ns (5.04 us) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| remove comp from 2-type entity | 3,863,817 (64,397) | 3,618,641 (60,311) | 4,327,678 (72,128) | 4,354,179 (72,570) |
| remove comp from 4-type entity | 2,530,467 (42,174) | 2,699,803 (44,997) | 2,768,921 (46,149) | 2,648,860 (44,148) |
| remove comp from 8-type entity | 1,671,450 (27,857) | 1,635,503 (27,258) | 1,699,272 (28,321) | 1,291,082 (21,518) |

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
| hasComponent | 71 ns (166 ns) | 71 ns (167 ns) | 78 ns (208 ns) | 56 ns (209 ns) | 62 ns (208 ns) |
| getComponentValue | 79 ns (208 ns) | 82 ns (166 ns) | 80 ns (209 ns) | 73 ns (209 ns) | 76 ns (209 ns) |
| setComponentValue | 121 ns (209 ns) | 125 ns (208 ns) | 116 ns (208 ns) | 112 ns (167 ns) | 132 ns (333 ns) |

ops/sec (ops/frame):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|-------:|------:|-------:|------:|
| hasComponent | 14,142,474 (235,708) | 14,051,506 (234,192) | 12,790,567 (213,176) | 17,894,121 (298,235) | 16,008,661 (266,811) |
| getComponentValue | 12,732,557 (212,209) | 12,131,695 (202,195) | 12,568,774 (209,480) | 13,620,916 (227,015) | 13,082,563 (218,043) |
| setComponentValue | 8,296,024 (138,267) | 8,008,196 (133,470) | 8,610,052 (143,501) | 8,891,117 (148,185) | 7,598,194 (126,637) |

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
| iter all | 657 ns (833 ns) | 6.17 us (10.09 us) | 54.49 us (65.51 us) | 532.75 us (720.79 us) |
| iter selective | 321 ns (417 ns) | 2.63 us (3.21 us) | 23.74 us (31.46 us) | 237.91 us (292.96 us) |
| iter narrow | -- | 297 ns (375 ns) | 2.82 us (3.50 us) | 40.07 us (50.79 us) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| iter all | 1,521,100 (25,352) | 162,068 (2,701) | 18,353 (306) | 1,877 (31) |
| iter selective | 3,114,706 (51,912) | 380,951 (6,349) | 42,119 (702) | 4,203 (70) |
| iter narrow | -- | 3,363,694 (56,062) | 354,404 (5,907) | 24,953 (416) |

ent/sec (ent/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| iter all | 152.1 M (2,535,167) | 162.1 M (2,701,137) | 183.5 M (3,058,901) | 187.7 M (3,128,437) |
| iter selective | 149.5 M (2,491,765) | 168.8 M (2,812,688) | 182.6 M (3,043,802) | 188.5 M (3,141,816) |
| iter narrow | -- | 154.7 M (2,578,832) | 178.3 M (2,971,088) | 181.0 M (3,016,844) |

alloc/op (retained):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| iter all | 4.6 KB (+0 B) | 39.8 KB (-8 B) | 391.4 KB (-9 B) | 3.8 MB (-0 B) |
| iter selective | 2.6 KB (-8 B) | 18.0 KB (-8 B) | 170.1 KB (-8 B) | 1.7 MB (-0 B) |
| iter narrow | -- | 2.5 KB (-8 B) | 20.2 KB (-0 B) | 284.0 KB (-0 B) |
