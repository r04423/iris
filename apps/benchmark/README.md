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
| create empty entity | 172 ns (875 ns) | 131 ns (375 ns) | 120 ns (167 ns) | 121 ns (167 ns) | 131 ns (292 ns) |
| create entity + 2 types | 451 ns (1.13 us) | 430 ns (1.17 us) | 406 ns (459 ns) | 416 ns (583 ns) | 446 ns (629 ns) |
| create entity + 4 types | 804 ns (1.63 us) | 822 ns (1.79 us) | 768 ns (1.29 us) | 768 ns (1.00 us) | 827 ns (1.13 us) |
| create entity + 8 types | 2.10 us (3.08 us) | 2.19 us (3.38 us) | 2.15 us (2.50 us) | 2.07 us (2.58 us) | 2.08 us (2.54 us) |

ops/sec (ops/frame):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|-------:|------:|-------:|------:|
| create empty entity | 5,804,002 (96,733) | 7,628,271 (127,138) | 8,366,312 (139,439) | 8,237,247 (137,287) | 7,617,638 (126,961) |
| create entity + 2 types | 2,218,670 (36,978) | 2,325,389 (38,756) | 2,465,956 (41,099) | 2,406,319 (40,105) | 2,244,077 (37,401) |
| create entity + 4 types | 1,243,259 (20,721) | 1,216,840 (20,281) | 1,302,280 (21,705) | 1,302,521 (21,709) | 1,209,804 (20,163) |
| create entity + 8 types | 476,287 (7,938) | 456,535 (7,609) | 465,020 (7,750) | 484,167 (8,069) | 479,929 (7,999) |

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
| destroy empty entity | 282 ns (625 ns) | 226 ns (334 ns) | 188 ns (292 ns) | 213 ns (334 ns) |
| destroy entity + 2 types | 404 ns (1.13 us) | 328 ns (500 ns) | 283 ns (500 ns) | 324 ns (1.50 us) |
| destroy entity + 4 types | 425 ns (1.29 us) | 502 ns (1.67 us) | 362 ns (588 ns) | 430 ns (1.21 us) |
| destroy entity + 8 types | 581 ns (1.71 us) | 886 ns (1.67 us) | 494 ns (792 ns) | 925 ns (2.12 us) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| destroy empty entity | 3,544,886 (59,081) | 4,421,638 (73,694) | 5,330,824 (88,847) | 4,699,069 (78,318) |
| destroy entity + 2 types | 2,476,914 (41,282) | 3,044,373 (50,740) | 3,537,112 (58,952) | 3,089,064 (51,484) |
| destroy entity + 4 types | 2,351,477 (39,191) | 1,990,163 (33,169) | 2,761,534 (46,026) | 2,327,638 (38,794) |
| destroy entity + 8 types | 1,720,285 (28,671) | 1,129,101 (18,818) | 2,025,681 (33,761) | 1,081,493 (18,025) |

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
| add comp to empty entity | 178 ns (250 ns) | 178 ns (250 ns) | 186 ns (291 ns) | 179 ns (250 ns) | 166 ns (250 ns) |
| add comp to 2-type entity | 303 ns (500 ns) | 301 ns (546 ns) | 312 ns (542 ns) | 303 ns (504 ns) | 332 ns (546 ns) |
| add comp to 4-type entity | 422 ns (1.79 us) | 431 ns (2.33 us) | 435 ns (3.09 us) | 433 ns (2.89 us) | 462 ns (3.13 us) |
| add comp to 8-type entity | 591 ns (2.88 us) | 611 ns (3.34 us) | 637 ns (5.09 us) | 620 ns (4.76 us) | 631 ns (4.82 us) |

ops/sec (ops/frame):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|-------:|------:|-------:|------:|
| add comp to empty entity | 5,629,989 (93,833) | 5,608,416 (93,474) | 5,387,262 (89,788) | 5,595,135 (93,252) | 6,020,435 (100,341) |
| add comp to 2-type entity | 3,298,382 (54,973) | 3,318,268 (55,304) | 3,201,401 (53,357) | 3,295,841 (54,931) | 3,013,705 (50,228) |
| add comp to 4-type entity | 2,367,384 (39,456) | 2,318,339 (38,639) | 2,298,269 (38,304) | 2,307,949 (38,466) | 2,166,427 (36,107) |
| add comp to 8-type entity | 1,692,243 (28,204) | 1,635,661 (27,261) | 1,569,235 (26,154) | 1,612,485 (26,875) | 1,583,617 (26,394) |

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
| remove comp from 2-type entity | 219 ns (375 ns) | 205 ns (334 ns) | 237 ns (959 ns) | 201 ns (375 ns) |
| remove comp from 4-type entity | 318 ns (917 ns) | 304 ns (796 ns) | 319 ns (834 ns) | 331 ns (875 ns) |
| remove comp from 8-type entity | 521 ns (3.80 us) | 538 ns (4.46 us) | 558 ns (4.42 us) | 653 ns (4.79 us) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| remove comp from 2-type entity | 4,567,343 (76,122) | 4,889,036 (81,484) | 4,211,477 (70,191) | 4,971,387 (82,856) |
| remove comp from 4-type entity | 3,144,162 (52,403) | 3,285,260 (54,754) | 3,135,453 (52,258) | 3,018,068 (50,301) |
| remove comp from 8-type entity | 1,918,980 (31,983) | 1,857,414 (30,957) | 1,793,137 (29,886) | 1,531,678 (25,528) |

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
| hasComponent | 59 ns (125 ns) | 66 ns (125 ns) | 66 ns (125 ns) | 49 ns (84 ns) | 43 ns (84 ns) |
| getComponentValue | 73 ns (125 ns) | 75 ns (125 ns) | 69 ns (125 ns) | 64 ns (167 ns) | 61 ns (84 ns) |
| setComponentValue | 116 ns (167 ns) | 109 ns (208 ns) | 106 ns (167 ns) | 115 ns (167 ns) | 112 ns (208 ns) |

ops/sec (ops/frame):

| Benchmark | empty | xsmall | small | medium | large |
|-----------|------:|-------:|------:|-------:|------:|
| hasComponent | 16,860,373 (281,006) | 15,190,174 (253,170) | 15,106,866 (251,781) | 20,377,552 (339,626) | 23,218,507 (386,975) |
| getComponentValue | 13,625,265 (227,088) | 13,359,622 (222,660) | 14,411,828 (240,197) | 15,569,616 (259,494) | 16,343,925 (272,399) |
| setComponentValue | 8,597,943 (143,299) | 9,214,838 (153,581) | 9,467,696 (157,795) | 8,660,562 (144,343) | 8,921,823 (148,697) |

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
| iter all | 615 ns (708 ns) | 5.66 us (6.12 us) | 54.15 us (61.01 us) | 525.20 us (585.02 us) |
| iter selective | 304 ns (375 ns) | 2.43 us (2.71 us) | 23.65 us (26.75 us) | 234.40 us (276.13 us) |
| iter narrow | -- | 279 ns (333 ns) | 2.76 us (3.00 us) | 38.65 us (43.96 us) |

ops/sec (ops/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| iter all | 1,625,367 (27,089) | 176,601 (2,943) | 18,468 (308) | 1,904 (32) |
| iter selective | 3,288,263 (54,804) | 411,863 (6,864) | 42,285 (705) | 4,266 (71) |
| iter narrow | -- | 3,582,311 (59,705) | 362,340 (6,039) | 25,872 (431) |

ent/sec (ent/frame):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| iter all | 162.5 M (2,708,944) | 176.6 M (2,943,353) | 184.7 M (3,078,037) | 190.4 M (3,173,415) |
| iter selective | 157.8 M (2,630,610) | 182.5 M (3,040,919) | 183.3 M (3,055,822) | 191.3 M (3,188,791) |
| iter narrow | -- | 164.8 M (2,746,438) | 182.3 M (3,037,615) | 187.7 M (3,127,943) |

alloc/op (retained):

| Benchmark | xsmall | small | medium | large |
|-----------|-------:|------:|-------:|------:|
| iter all | 4.6 KB (+0 B) | 39.8 KB (-8 B) | 391.4 KB (-9 B) | 3.8 MB (-0 B) |
| iter selective | 2.6 KB (-8 B) | 18.0 KB (-8 B) | 170.1 KB (-8 B) | 1.7 MB (-0 B) |
| iter narrow | -- | 2.5 KB (-8 B) | 20.2 KB (-0 B) | 284.0 KB (-0 B) |
