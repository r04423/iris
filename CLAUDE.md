# Iris

Libraries for building realtime applications in TypeScript.

## Principles

**Performance through simplicity** -- Simple code is fast code. Index-based `for` loops over iterators. `Map`/`Set` over object lookups in hot paths. TypedArrays for columnar data. Non-null assertions (`!`) where proven safe. Never chase synthetic benchmarks -- measure real workloads.

**Type safety is non-negotiable** -- Full TypeScript inference across all public APIs. Branded types for ID safety. Phantom type fields carry schema information at zero runtime cost. No `any` in public API surface. If a type can't be inferred, the API design is wrong.

**Data and logic are separate** -- All data lives in plain objects, TypedArrays, Maps, and Sets. All logic lives in pure functions. No classes. No methods on data structures. This makes state inspectable, serializable, and cache-friendly.

**Documentation is code** -- JSDoc with `@example` blocks MUST exist on all public APIs (everything exported from `index.ts`). Functions exported from their module but NOT from `index.ts` MUST have the `@internal` tag. Section headers (`// ====`) divide files into logical regions. Comments explain "why", never "what."

**Zero runtime dependencies** -- The core library is fully self-contained. No npm packages at runtime. Every byte shipped is code we wrote and can debug.

**YAGNI** -- No abstractions until code proves necessity. No speculative error codes, utilities, or patterns. If grep finds zero usages, delete it. Three similar lines of code is better than a premature abstraction.

**Tests are production code** -- Same quality standards as implementation. One behavior per test, minimal setup. Test only the module's public contract. Strive to cover all scenarios including edge cases. If a behavior is tested elsewhere, don't retest it. Test names describe behavior, not implementation.

## Commands

| Command | Description |
|---------|-------------|
| `pnpm run validate` | Typecheck + lint (run before commits) |
| `pnpm run test` | Run all tests |
| `pnpm run check:fix` | Auto-fix lint/format issues |
| `pnpm run build -F iris-ecs` | Build specific package |
| `pnpm bench` | All benchmark suites (throughput mode) |
| `pnpm --filter iris-benchmark bench Entity` | Single benchmark suite |
| `pnpm --filter iris-benchmark bench:memory` | Memory profiling mode |

## Architecture

Monorepo structure:
- `packages/ecs` -- Core ECS library (iris-ecs)
- `packages/*` -- Future library packages
- `apps/benchmark` -- Performance benchmarks
- `apps/*` -- Example applications