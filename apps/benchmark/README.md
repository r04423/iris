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
| create empty entity | 168 ns (833 ns) | 135 ns (296 ns) | 136 ns (209 ns) | 136 ns (208 ns) | 136 ns (333 ns) |
| create entity + 2 types | 502 ns (1.25 us) | 427 ns (963 ns) | 413 ns (674 ns) | 431 ns (583 ns) | 485 ns (792 ns) |
| create entity + 4 types | 880 ns (1.67 us) | 848 ns (1.46 us) | 872 ns (1.67 us) | 1.09 us (1.17 us) | 822 ns (1.08 us) |
| create entity + 8 types | 2.42 us (3.30 us) | 2.40 us (3.29 us) | 2.36 us (3.08 us) | 2.43 us (3.17 us) | 2.41 us (3.00 us) |

ops/sec (ops/frame):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|-------:|------:|-------:|------:|
| create empty entity | 5,945,309 (99,088) | 7,402,929 (123,382) | 7,373,531 (122,892) | 7,331,147 (122,186) | 7,339,357 (122,323) |
| create entity + 2 types | 1,990,099 (33,168) | 2,343,058 (39,051) | 2,422,767 (40,379) | 2,317,873 (38,631) | 2,063,399 (34,390) |
| create entity + 4 types | 1,136,719 (18,945) | 1,179,393 (19,657) | 1,146,346 (19,106) | 918,238 (15,304) | 1,217,032 (20,284) |
| create entity + 8 types | 412,881 (6,881) | 416,893 (6,948) | 423,646 (7,061) | 410,818 (6,847) | 415,238 (6,921) |

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
| destroy empty entity | 278 ns (500 ns) | 224 ns (375 ns) | 197 ns (292 ns) | 196 ns (334 ns) |
| destroy entity + 2 types | 553 ns (1.21 us) | 373 ns (917 ns) | 318 ns (500 ns) | 331 ns (541 ns) |
| destroy entity + 4 types | 463 ns (1.21 us) | 554 ns (2.05 us) | 412 ns (750 ns) | 449 ns (1.25 us) |
| destroy entity + 8 types | 678 ns (1.54 us) | 674 ns (1.54 us) | 599 ns (1.21 us) | 614 ns (1.21 us) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| destroy empty entity | 3,602,063 (60,034) | 4,467,010 (74,450) | 5,074,218 (84,570) | 5,098,351 (84,973) |
| destroy entity + 2 types | 1,809,534 (30,159) | 2,682,605 (44,710) | 3,147,882 (52,465) | 3,018,018 (50,300) |
| destroy entity + 4 types | 2,162,010 (36,034) | 1,803,640 (30,061) | 2,425,472 (40,425) | 2,228,877 (37,148) |
| destroy entity + 8 types | 1,474,495 (24,575) | 1,484,432 (24,741) | 1,669,867 (27,831) | 1,628,270 (27,138) |

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
| add comp to empty entity | 161 ns (209 ns) | 159 ns (250 ns) | 169 ns (250 ns) | 157 ns (209 ns) | 156 ns (250 ns) |
| add comp to 2-type entity | 300 ns (588 ns) | 304 ns (629 ns) | 310 ns (504 ns) | 303 ns (546 ns) | 302 ns (625 ns) |
| add comp to 4-type entity | 434 ns (1.83 us) | 435 ns (2.00 us) | 439 ns (2.09 us) | 440 ns (2.55 us) | 437 ns (2.97 us) |
| add comp to 8-type entity | 664 ns (3.13 us) | 674 ns (3.26 us) | 674 ns (3.55 us) | 649 ns (4.13 us) | 679 ns (5.26 us) |

ops/sec (ops/frame):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|-------:|------:|-------:|------:|
| add comp to empty entity | 6,208,996 (103,483) | 6,295,921 (104,932) | 5,900,585 (98,343) | 6,366,600 (106,110) | 6,430,555 (107,176) |
| add comp to 2-type entity | 3,337,354 (55,623) | 3,284,395 (54,740) | 3,230,675 (53,845) | 3,303,859 (55,064) | 3,315,072 (55,251) |
| add comp to 4-type entity | 2,305,333 (38,422) | 2,296,456 (38,274) | 2,276,338 (37,939) | 2,273,008 (37,883) | 2,287,446 (38,124) |
| add comp to 8-type entity | 1,505,536 (25,092) | 1,483,594 (24,727) | 1,483,363 (24,723) | 1,540,747 (25,679) | 1,472,840 (24,547) |

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
| remove comp from 2-type entity | 255 ns (458 ns) | 239 ns (416 ns) | 223 ns (334 ns) | 234 ns (375 ns) |
| remove comp from 4-type entity | 382 ns (833 ns) | 362 ns (916 ns) | 351 ns (879 ns) | 365 ns (875 ns) |
| remove comp from 8-type entity | 620 ns (3.80 us) | 628 ns (4.50 us) | 627 ns (4.63 us) | 650 ns (5.00 us) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| remove comp from 2-type entity | 3,919,593 (65,327) | 4,180,276 (69,671) | 4,486,864 (74,781) | 4,266,156 (71,103) |
| remove comp from 4-type entity | 2,618,409 (43,640) | 2,760,619 (46,010) | 2,851,070 (47,518) | 2,737,281 (45,621) |
| remove comp from 8-type entity | 1,612,623 (26,877) | 1,593,181 (26,553) | 1,595,208 (26,587) | 1,537,965 (25,633) |

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
| hasComponent | 62 ns (125 ns) | 65 ns (125 ns) | 65 ns (125 ns) | 45 ns (84 ns) | 40 ns (125 ns) |
| getComponentValue | 67 ns (125 ns) | 66 ns (125 ns) | 66 ns (125 ns) | 63 ns (125 ns) | 58 ns (166 ns) |
| setComponentValue | 87 ns (167 ns) | 89 ns (125 ns) | 80 ns (125 ns) | 76 ns (125 ns) | 78 ns (167 ns) |

ops/sec (ops/frame):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|-------:|------:|-------:|------:|
| hasComponent | 16,099,395 (268,323) | 15,363,322 (256,055) | 15,418,378 (256,973) | 22,214,750 (370,246) | 25,030,172 (417,170) |
| getComponentValue | 14,905,223 (248,420) | 15,106,698 (251,778) | 15,087,862 (251,464) | 15,930,367 (265,506) | 17,342,521 (289,042) |
| setComponentValue | 11,451,065 (190,851) | 11,286,918 (188,115) | 12,508,990 (208,483) | 13,182,392 (219,707) | 12,798,600 (213,310) |

alloc/op (retained):

| Benchmark | empty | small | medium | large |
|-----------|------:|------:|-------:|------:|
| hasComponent | 144 B (+0 B) | 0 B (+0 B) | 0 B (+0 B) | 0 B (+0 B) |
| getComponentValue | 144 B (+0 B) | 0 B (+0 B) | 0 B (+0 B) | 0 B (+0 B) |
| setComponentValue | 208 B (+0 B) | 64 B (+0 B) | 64 B (+0 B) | 64 B (+0 B) |

### Query Iteration

Iterate all matching entities through a pre-cached query. `ent/sec` = ops/sec x matching entity count.

**Entity callback** -- `queryEntities` calls the callback once per entity. Pure iteration with no component access.

Latency -- avg (P99):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| iter all | 564 ns (709 ns) | 5.00 us (5.29 us) | 45.66 us (53.37 us) | 437.52 us (494.64 us) |
| iter selective | 278 ns (375 ns) | 2.21 us (2.46 us) | 19.14 us (20.38 us) | 198.12 us (234.34 us) |
| iter narrow | -- | 256 ns (334 ns) | 2.41 us (2.71 us) | 33.32 us (38.13 us) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| iter all | 1,772,268 (29,538) | 199,928 (3,332) | 21,900 (365) | 2,286 (38) |
| iter selective | 3,598,200 (59,970) | 452,263 (7,538) | 52,244 (871) | 5,047 (84) |
| iter narrow | -- | 3,899,235 (64,987) | 414,313 (6,905) | 30,008 (500) |

ent/sec (ent/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| iter all | 177.2 M (2,953,780) | 199.9 M (3,332,126) | 219.0 M (3,650,071) | 228.6 M (3,809,363) |
| iter selective | 172.7 M (2,878,560) | 200.4 M (3,339,209) | 226.5 M (3,775,491) | 226.4 M (3,772,708) |
| iter narrow | -- | 179.4 M (2,989,413) | 208.4 M (3,473,328) | 217.7 M (3,627,947) |

alloc/op (retained):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| iter all | 4.6 KB (+0 B) | 39.8 KB (-8 B) | 391.4 KB (-9 B) | 3.8 MB (-0 B) |
| iter selective | 2.6 KB (-8 B) | 18.0 KB (-8 B) | 170.1 KB (-8 B) | 1.7 MB (-0 B) |
| iter narrow | -- | 2.5 KB (-8 B) | 20.2 KB (-0 B) | 284.0 KB (-0 B) |

**Column callback** -- `queryColumns` calls the callback once per archetype with direct column access. Pure iteration with no data access.

Latency -- avg (P99):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| columns iter all | 1.16 us (1.42 us) | 7.78 us (9.54 us) | 64.52 us (84.55 us) | 567.25 us (659.37 us) |
| columns iter selective | 514 ns (625 ns) | 3.43 us (3.63 us) | 26.98 us (35.56 us) | 258.55 us (352.25 us) |
| columns iter narrow | -- | 334 ns (375 ns) | 3.12 us (3.29 us) | 41.87 us (56.71 us) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| columns iter all | 861,939 (14,366) | 128,504 (2,142) | 15,499 (258) | 1,763 (29) |
| columns iter selective | 1,947,126 (32,452) | 291,737 (4,862) | 37,061 (618) | 3,868 (64) |
| columns iter narrow | -- | 2,993,260 (49,888) | 320,583 (5,343) | 23,885 (398) |

ent/sec (ent/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| columns iter all | 86.2 M (1,436,565) | 128.5 M (2,141,727) | 155.0 M (2,583,190) | 176.3 M (2,938,131) |
| columns iter selective | 93.5 M (1,557,701) | 129.2 M (2,153,989) | 160.7 M (2,678,274) | 173.5 M (2,890,976) |
| columns iter narrow | -- | 137.7 M (2,294,833) | 161.3 M (2,687,552) | 173.3 M (2,887,717) |

**Data access** -- Increment a scalar component field on every matching entity. Compares per-entity `getComponentValue`/`setComponentValue` against direct TypedArray mutation via `queryColumns`.

Latency -- avg (P99):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| increment via entities | 7.04 us (7.25 us) | 71.81 us (74.09 us) | 695.16 us (719.17 us) | 7.72 ms (8.52 ms) |
| increment via columns | 846 ns (958 ns) | 3.21 us (3.42 us) | 15.70 us (18.29 us) | 96.19 us (110.13 us) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| increment via entities | 142,075 (2,368) | 13,925 (232) | 1,439 (24) | 130 (2) |
| increment via columns | 1,181,802 (19,697) | 311,108 (5,185) | 63,691 (1,062) | 10,396 (173) |

ent/sec (ent/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| increment via entities | 14.2 M (236,791) | 13.9 M (232,091) | 14.4 M (239,753) | 13.0 M (215,835) |
| increment via columns | 118.2 M (1,969,669) | 311.1 M (5,185,126) | 636.9 M (10,615,194) | 1.0 B (17,327,223) |
