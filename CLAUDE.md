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

## Documentation Style

Persona: public docs address a developer who knows ECS concepts but not Iris internals. Internal docs and inline comments address a senior engineer skimming the module.
 
**Public API (exported from `index.ts`)**
- Third-person one-line summary, then only facts a caller acts on: idempotence, no-op paths, type narrowing, view invalidation, lifetimes.
- One `{@link}` pointer to the API that completes the workflow (accessor -> its guard, zero-copy view -> `markComponentChanged`).
- `@example` fenced with ```` ```typescript ````, required. For overloaded functions the doc goes on the first overload.
- No `@param`/`@returns` that restate the signature; keep those that add facts. `@throws` always, with the condition.
- Never describe implementation: storage layout, encodings, caching, internal module names.

**Type fields**
- Single-line form when it fits the 120-char width: `/** Dense entity list; the index is the entity's row in every column. */`. Block form only when the doc genuinely needs multiple lines or carries tags.

**Internal (exported but not in `index.ts`, or module-private)**
- `@internal` tag on every export not re-exported from `index.ts`. Not on module-private functions -- the tag marks cross-module exports only.
- 1-3 lines: role, plus the one "why" a reader can't see in the code. No `@param` lists, no `@example`.

**Inline comments**
- One-line flow markers for multi-step function bodies; "why" comments for non-obvious constraints. Never narrate what the next line does.

**Factual accuracy**
- Every behavioral claim must be traceable to a specific line of code, verified at write time -- read the callers and tests when unsure. Wrong documentation is worse than missing documentation.

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