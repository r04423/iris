# Iris

High-performance, Entity Component System library for TypeScript.

## Commands

| Command | Description |
|---------|-------------|
| `pnpm run validate` | Typecheck + lint (run before commits) |
| `pnpm run test` | Run all tests |
| `pnpm run check:fix` | Auto-fix lint/format issues |
| `pnpm run build -F iris-ecs` | Build specific package |

## Philosophy

**Performance through simplicity** - Write expressive, readable code that is also performant. Simple code is easier to optimize and maintain.

**Documentation is code** - JSDoc with `@example` blocks required for all public APIs. Inline comments explain "why" for non-obvious logic. Clear docs help both humans and LLMs understand intent.

## Architecture

Monorepo structure:
- `packages/ecs` - Core ECS library (iris-ecs)
- `packages/*` - Future library packages
- `apps/*` - Example applications

### Module Overview

| Module | Responsibility |
|--------|----------------|
| `encoding.ts` | Bit-packed ID encoding (Entity, Tag, Component, Relation, Pair types) |
| `world.ts` | World creation and state container (entity registry, archetypes, queries) |
| `entity.ts` | Entity lifecycle (create, destroy, aliveness check, ID recycling) |
| `component.ts` | Component add/remove/get/set operations, archetype transitions |
| `archetype.ts` | Columnar storage, capacity management, graph traversal |
| `registry.ts` | Component/Tag/Relation definitions (defineComponent, defineTag, defineRelation) |
| `relation.ts` | Pair encoding/decoding, relation target queries |
| `query.ts` | Entity queries with filters (added, changed, not), change detection |
| `filters.ts` | Query filter matching against archetypes |
| `scheduler.ts` | System registration and schedule execution |
| `observer.ts` | Lifecycle event callbacks (entityCreated, componentAdded, etc.) |
| `event.ts` | Event queue system for inter-system communication |
| `resource.ts` | Singleton resources (world-scoped data) |
| `name.ts` | Entity naming and lookup by name |
| `removal.ts` | Removal detection for queries |
| `schema.ts` | Type definitions for component data (Type.f32(), Type.i32(), etc.) |
| `actions.ts` | Cached world-bound action getters |

### ECS Core Concepts
- **Entities**: Lightweight 32-bit identifiers with generation tracking
- **Components**: Data (typed schemas) or Tags (markers)
- **Archetypes**: Columnar storage grouping entities by component set
- **Relations**: Directed entity pairs (e.g., ChildOf, InstanceOf)
- **Queries**: Filtered entity iteration with change detection

## Code Patterns

**Branded types** for type safety - never use raw numbers for Entity, Tag, Component IDs:
```typescript
type Entity = number & { [ENTITY_BRAND]: true };
```

**Built-in primitives only** - No classes. Use plain objects, TypedArrays, Maps, Sets:
```typescript
// Good: plain object with typed fields
type Archetype = { types: EntityId[]; columns: Map<EntityId, FieldColumns>; ... };

// Avoid: class definitions
class Archetype { ... }
```

**Simple iteration** - Prefer `for` loops with index access over `for...of`:
```typescript
// Good: index-based for loop
for (let i = 0; i < archetype.types.length; i++) {
  const typeId = archetype.types[i]!;
  // ...
}

// Avoid: for...of (creates iterator overhead)
for (const typeId of archetype.types) { ... }
```

**Non-null assertions** (!) allowed where proven safe in performance-critical paths

**Function overloads** for optional data parameters - see component.ts pattern

## Testing

**Tests are production code** - Apply same quality standards to tests as implementation.

- Native Node.js test runner via tsx
- Test files colocated: `foo.ts` → `foo.test.ts`
- Run single test: `pnpm tsx --test packages/ecs/src/foo.test.ts`
- All tests must pass before committing

**Test principles:**
- **Minimal** - One behavior per test, minimal setup
- **Relevant** - Test only the module's public contract
- **Exhaustive** - Strive to cover all usage scenarios, including edge cases
- **No duplication** - If a behavior is tested elsewhere, don't retest it
- **Descriptive names** - Test name should describe the behavior, not implementation

## Constraints

- **Zero runtime dependencies** - Core library is self-contained
- **YAGNI** - Don't add abstractions until code proves necessity. No speculative error codes, utilities, or patterns. If grep finds zero usages, delete it.