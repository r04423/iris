---
name: bench
description: Run and interpret ECS benchmark results. Use after performance-sensitive changes to core ECS operations (entity create/destroy, component add/remove/access, query iteration).
user-invokable: true
argument-hint: "[Entity|Component|Query] [--memory]"
---

Run benchmark suites for iris-ecs and interpret results.

## Steps

1. Run `pnpm --filter iris-benchmark bench $ARGUMENTS` from the repo root
   - If no arguments, runs all suites in throughput mode
   - Suite names: `Entity`, `Component`, `Query`
   - Add `--memory` for memory profiling mode (harness handles `--expose-gc`)
2. Read the reference numbers from `apps/benchmark/README.md` (look for the results tables)
3. Present results in a comparison table: measured value vs reference value
4. Flag any regressions:
   - **>5% drop** in ops/sec -> performance regression
   - **>5% increase** in alloc/op -> memory regression
5. Note: results are machine-sensitive -- only compare numbers from the same machine and similar conditions

## Context

Benchmarks use realistic, controllably-random archetype fragmentation with 14 entity templates, power-law weights, and seeded RNG for deterministic reproducibility. See `apps/benchmark/CLAUDE.md` for the full philosophy and `apps/benchmark/README.md` for detailed methodology.
