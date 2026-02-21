# iris-benchmark

Performance benchmarks for Iris ECS. See @README.md for full methodology and latest results.

## Philosophy

Benchmarks use **realistic, controllably-random archetype fragmentation** -- not synthetic micro-benchmarks. The goal is to measure performance under conditions that resemble real applications.

- **Template system**: 14 entity templates across 3 width groups (2/4/8 types) with power-law weights -- "hot" templates (Particle, Enemy, Prop) spawn far more often than "cold" ones (Player, Waypoint)
- **Archetype fragmentation**: A modifier pool of 20 optional types (10 components, 10 tags) is applied probabilistically during world population, creating a long tail of archetype variants beyond the 14 base templates
- **Seeded RNG**: splitmix32 with separate seeds (789 for templates, 456 for modifiers, 123 for queries) ensures bit-for-bit reproducibility -- identical seeds produce identical worlds for reliable regression detection
- **Query selectivity**: Three tiers (iter all ~100%, iter selective ~45%, iter narrow ~7%) test different matching rates against naturally-fragmented archetype sets
- **Dual-mode measurement**: Throughput (8,192 fixed iterations, latency percentiles) and Memory (8 independent samples, per-op allocation distribution, GC retention)

## Structure

```
src/
  main.ts              CLI entry point, benchmark runner, iteration/warmup config
  types.ts             Suite, Benchmark, MemoryResult type definitions
  memory.ts            Memory profiler (heap snapshots, trimmed means, GC detection)
  report.ts            Throughput and memory report formatting (ASCII tables, histograms)
  libs/
    types.ts           Library adapter interface
    iris/
      index.ts         Iris adapter registration
      rng.ts           splitmix32 seeded RNG
      fixtures.ts      Generated 400 components + 400 tags for pool allocation
      pool.ts          Template system, modifier pool, TemplateAssignment targets
      presets.ts       5 preset factories (empty/xsmall/small/medium/large)
      suites/
        entity.ts      Entity create/destroy benchmarks
        component.ts   Component add/remove/access benchmarks
        query.ts       Query iteration benchmarks
```

## Design Decisions

**Worlds accumulate state** -- Benchmarks intentionally accumulate entities across iterations rather than creating fresh worlds. A fresh world per iteration adds prohibitive GC noise and misses steady-state performance characteristics.

**Pooled entities with pre-resolved targets** -- `TemplateAssignment` pre-computes all operation targets (add/remove/has/get/set) during setup so hot loops are O(1) with zero lookups. This separates entity creation cost from the operation being measured.

**Modifier rate inversely correlates with world size** -- Larger worlds need fewer modifiers per entity to achieve similar archetype diversity. xsmall uses 10%, large uses 0.2%.

**Query cache activation** -- Presets pre-execute template-derived queries (1-3 terms each, ~20% chance of modifier terms) to populate internal query caches. This simulates realistic cache pressure from queries that target component sets that actually co-occur.

## When to Run

Run benchmarks before and after changes to core ECS internals: archetype transitions, entity lifecycle, component operations, query iteration. Compare ops/sec and alloc/op numbers **from the same machine** -- results are hardware-sensitive.
