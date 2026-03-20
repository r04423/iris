# iris-react

React bindings for Iris ECS.

## Module Overview

| Module | Responsibility |
|--------|----------------|
| `context.tsx` | WorldProvider component, useWorld hook, reset generation context |
| `useActions.ts` | Cached actions hook (useMemo wrapper) |
| `useComponentValue.ts` | Single component field reactive read |
| `useComponentEffect.ts` | Side-effect callback on component changes |
| `useHasComponent.ts` | Boolean component presence check |
| `useQueryEntities.ts` | Reactive entity query with dirty-flag optimization |
| `useQueryFirstEntity.ts` | First-match wrapper around useQueryEntities |

## Architecture

**Observer-driven subscriptions** -- All reactive hooks subscribe to iris-ecs observers (`componentAdded`, `componentRemoved`, `componentChanged`, `entityDestroyed`). Each hook registers filtered callbacks that check entity/component identity with strict equality on branded numbers -- two number comparisons per event, O(1). The `subscribe` function is memoized via `useCallback` keyed on `[world, entityId, componentId]` to prevent re-registration on every render.

**`useSyncExternalStore` contract** -- Three hooks (`useComponentValue`, `useHasComponent`, `useQueryEntities`) use `useSyncExternalStore` for concurrent-mode safety. The `subscribe` function registers observer callbacks and returns an unsubscribe function. The `getSnapshot` function reads current ECS state.

**Reset generation** -- `WorldProvider` registers a `worldReset` observer that increments a generation counter exposed via `ResetGenerationContext`. All hooks consume this counter as a `useCallback`/`useMemo` dependency. When `resetWorld()` clears `world.queries.byId` and `world.entities.byId`, the generation bump forces hooks to re-run `ensureQuery`/`cacheQuery` and re-read snapshots against the fresh world state.

**Snapshot stability** -- `useComponentValue` reads primitives from TypedArray columns; `Object.is` provides free referential stability for numbers, strings, and booleans. `useQueryEntities` performs shallow array comparison (index-by-index) against the cached result to preserve reference stability when contents haven't changed.

## Code Patterns

**`node:test` + `@testing-library/react`** -- Tests use `renderHook` and `act` from `@testing-library/react`. Everything else follows the standard `import assert from "node:assert"; import { describe, it } from "node:test"` pattern.

**`createWrapper` helper** -- Test files define a `createWrapper(world)` function returning a component that wraps children in `<WorldProvider world={world}>`. This is passed as the `wrapper` option to `renderHook`.

**`biome-ignore` for exhaustive deps** -- Several hooks use `generation` as a dependency that Biome's exhaustive deps rule doesn't recognize. These are annotated with `// biome-ignore lint/correctness/useExhaustiveDependencies: <reason>`.

**Overloaded signatures** -- `useComponentValue` has multiple overload signatures to support typed `EntityWith<Component>`, `EntityWith<Pair>`, and generic `EntityId` inputs. The implementation signature is the last one.

**Section headers** -- Same `// ============================================================================` pattern as iris-ecs divides each file into logical regions.

**`index.ts` is the public API boundary** -- Only export from `index.ts` what users should access. Internal helpers (`useResetGeneration`, `termsToKey`) are exported from their module for cross-module use but are NOT re-exported from `index.ts`.
