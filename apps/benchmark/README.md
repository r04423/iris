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

Entities follow power-law weights within each group. Randomized queries are pre-executed against all pool types to populate internal caches.

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
| create empty entity | 183 ns (875 ns) | 137 ns (500 ns) | 133 ns (208 ns) | 130 ns (209 ns) | 231 ns (625 ns) |
| create entity + 2 types | 435 ns (1.21 us) | 427 ns (1.00 us) | 404 ns (1.08 us) | 424 ns (671 ns) | 529 ns (917 ns) |
| create entity + 4 types | 824 ns (1.58 us) | 788 ns (1.50 us) | 814 ns (1.63 us) | 1.26 us (2.67 us) | 916 ns (1.83 us) |
| create entity + 8 types | 2.12 us (3.38 us) | 2.08 us (2.96 us) | 2.04 us (2.71 us) | 2.02 us (2.46 us) | 2.24 us (2.71 us) |

ops/sec (ops/frame):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|-------:|------:|-------:|------:|
| create empty entity | 5,456,477 (90,941) | 7,278,588 (121,310) | 7,512,116 (125,202) | 7,709,842 (128,497) | 4,333,518 (72,225) |
| create entity + 2 types | 2,299,354 (38,323) | 2,339,966 (38,999) | 2,477,342 (41,289) | 2,361,076 (39,351) | 1,888,697 (31,478) |
| create entity + 4 types | 1,213,698 (20,228) | 1,269,391 (21,157) | 1,228,755 (20,479) | 794,248 (13,237) | 1,091,900 (18,198) |
| create entity + 8 types | 471,536 (7,859) | 479,734 (7,996) | 490,565 (8,176) | 495,030 (8,250) | 446,971 (7,450) |

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
| destroy empty entity | 257 ns (375 ns) | 222 ns (375 ns) | 195 ns (292 ns) | 236 ns (500 ns) |
| destroy entity + 2 types | 334 ns (875 ns) | 316 ns (583 ns) | 300 ns (459 ns) | 358 ns (917 ns) |
| destroy entity + 4 types | 405 ns (1.29 us) | 440 ns (1.42 us) | 377 ns (583 ns) | 462 ns (958 ns) |
| destroy entity + 8 types | 577 ns (1.55 us) | 574 ns (1.46 us) | 515 ns (1.05 us) | 580 ns (1.00 us) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| destroy empty entity | 3,897,554 (64,959) | 4,502,999 (75,050) | 5,123,164 (85,386) | 4,239,373 (70,656) |
| destroy entity + 2 types | 2,995,123 (49,919) | 3,166,273 (52,771) | 3,328,080 (55,468) | 2,796,039 (46,601) |
| destroy entity + 4 types | 2,467,698 (41,128) | 2,271,668 (37,861) | 2,654,502 (44,242) | 2,163,158 (36,053) |
| destroy entity + 8 types | 1,732,519 (28,875) | 1,741,067 (29,018) | 1,940,508 (32,342) | 1,725,193 (28,753) |

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
| add comp to empty entity | 198 ns (291 ns) | 180 ns (250 ns) | 181 ns (292 ns) | 175 ns (250 ns) | 181 ns (292 ns) |
| add comp to 2-type entity | 318 ns (504 ns) | 299 ns (588 ns) | 317 ns (546 ns) | 327 ns (546 ns) | 344 ns (625 ns) |
| add comp to 4-type entity | 410 ns (2.00 us) | 418 ns (1.97 us) | 417 ns (3.25 us) | 454 ns (2.79 us) | 484 ns (3.46 us) |
| add comp to 8-type entity | 612 ns (3.17 us) | 612 ns (3.46 us) | 632 ns (5.33 us) | 666 ns (6.26 us) | 678 ns (6.21 us) |

ops/sec (ops/frame):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|-------:|------:|-------:|------:|
| add comp to empty entity | 5,056,444 (84,274) | 5,557,568 (92,626) | 5,522,910 (92,049) | 5,699,369 (94,989) | 5,515,184 (91,920) |
| add comp to 2-type entity | 3,142,239 (52,371) | 3,343,420 (55,724) | 3,156,838 (52,614) | 3,060,748 (51,012) | 2,909,406 (48,490) |
| add comp to 4-type entity | 2,436,664 (40,611) | 2,393,806 (39,897) | 2,400,161 (40,003) | 2,204,465 (36,741) | 2,066,493 (34,442) |
| add comp to 8-type entity | 1,634,189 (27,236) | 1,633,377 (27,223) | 1,582,388 (26,373) | 1,501,550 (25,026) | 1,474,131 (24,569) |

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
| remove comp from 2-type entity | 250 ns (917 ns) | 213 ns (417 ns) | 213 ns (459 ns) | 225 ns (417 ns) |
| remove comp from 4-type entity | 351 ns (917 ns) | 325 ns (799 ns) | 343 ns (959 ns) | 350 ns (791 ns) |
| remove comp from 8-type entity | 564 ns (4.54 us) | 543 ns (4.54 us) | 596 ns (5.22 us) | 644 ns (5.29 us) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| remove comp from 2-type entity | 4,007,318 (66,789) | 4,696,119 (78,269) | 4,689,555 (78,159) | 4,439,418 (73,990) |
| remove comp from 4-type entity | 2,851,732 (47,529) | 3,078,918 (51,315) | 2,913,315 (48,555) | 2,855,383 (47,590) |
| remove comp from 8-type entity | 1,773,105 (29,552) | 1,840,647 (30,677) | 1,678,070 (27,968) | 1,551,654 (25,861) |

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
| hasComponent | 69 ns (125 ns) | 67 ns (125 ns) | 70 ns (125 ns) | 49 ns (125 ns) | 46 ns (167 ns) |
| getComponentValue | 70 ns (125 ns) | 69 ns (125 ns) | 71 ns (125 ns) | 62 ns (125 ns) | 61 ns (166 ns) |
| setComponentValue | 102 ns (167 ns) | 114 ns (167 ns) | 115 ns (167 ns) | 103 ns (167 ns) | 106 ns (208 ns) |

ops/sec (ops/frame):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|-------:|------:|-------:|------:|
| hasComponent | 14,572,338 (242,872) | 14,987,769 (249,796) | 14,221,654 (237,028) | 20,553,015 (342,550) | 21,747,845 (362,464) |
| getComponentValue | 14,370,568 (239,509) | 14,509,310 (241,822) | 14,024,636 (233,744) | 16,151,674 (269,195) | 16,388,490 (273,142) |
| setComponentValue | 9,820,587 (163,676) | 8,805,298 (146,755) | 8,718,696 (145,312) | 9,710,476 (161,841) | 9,463,682 (157,728) |

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
| iter all | 2.73 us (3.42 us) | 25.15 us (29.67 us) | 247.26 us (279.96 us) | 2.52 ms (2.80 ms) |
| iter selective | 1.34 us (1.67 us) | 10.85 us (11.88 us) | 103.50 us (114.43 us) | 1.07 ms (1.24 ms) |
| iter narrow | -- | 1.19 us (1.50 us) | 12.17 us (13.96 us) | 180.27 us (206.75 us) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| iter all | 366,146 (6,102) | 39,767 (663) | 4,044 (67) | 397 (7) |
| iter selective | 748,105 (12,468) | 92,171 (1,536) | 9,662 (161) | 931 (16) |
| iter narrow | -- | 840,885 (14,015) | 82,159 (1,369) | 5,547 (92) |

ent/sec (ent/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| iter all | 36.6 M (610,243) | 39.8 M (662,784) | 40.4 M (674,053) | 39.7 M (661,162) |
| iter selective | 33.7 M (561,079) | 40.6 M (675,918) | 41.5 M (692,440) | 41.6 M (693,300) |
| iter narrow | -- | 30.3 M (504,531) | 40.3 M (670,965) | 40.5 M (674,913) |

alloc/op (retained):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| iter all | 4.6 KB (+0 B) | 39.8 KB (-8 B) | 391.4 KB (-9 B) | 3.8 MB (-0 B) |
| iter selective | 2.6 KB (-8 B) | 18.0 KB (-8 B) | 170.1 KB (-8 B) | 1.7 MB (-0 B) |
| iter narrow | -- | 2.5 KB (-8 B) | 20.2 KB (-0 B) | 284.0 KB (-0 B) |
