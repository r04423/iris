# Iris

Iris is an Entity Component System for TypeScript. The engine is published as
`iris-ecs`, and `iris-react` adds React hooks on top of it. The goal is an ECS
that is fast because it is simple, fully typed without annotations, and pleasant
to read. Treat every change as part of a small, carefully kept library: the
public API is shrunk more often than it grows.

## Environment

- Node 24 or newer, pnpm 10, Turborepo, TypeScript in strict mode, ESM only.
  Relative imports end in `.js`.
- The compiler and Biome enforce formatting, `import type`, no enums, no `any`,
  and unused code. Run `pnpm check:fix` instead of formatting by hand.
- `pnpm validate` runs build, typecheck, Biome, and every test. CI runs the same
  command, so work is done when it passes.
- `pnpm --filter iris-ecs test` runs one package, and
  `pnpm --filter iris-ecs exec tsx --test src/query.test.ts` runs one file. Add
  `--test-name-pattern` for one test.
- Packages depend on each other through the built `dist`, not `src`. After
  changing the engine, rebuild before react, the apps, or the benchmark see it.
  Turbo does this for `pnpm test`; a filtered run does not.
- Never hand-edit `dist`, `.build-files.json`, or `packages/ecs/README.md`. All
  three are generated.

## Map

- `README.md` is the user guide and the npm page. Read it first to learn the
  API as users see it.
- `packages/ecs/src/index.ts` is the public API. Anything not exported there is
  internal. Each concept has its own module and a test file beside it.
- `packages/react/src` holds one hook per file, built on observers.
- `apps/space-shooter` is the reference game and the source of README examples.
  It uses the engine without React.
- `apps/benchmark` measures throughput and allocations on worlds up to 100k
  entities. `pnpm bench` and `pnpm --filter iris-benchmark bench:memory`.
- `skills/iris-ecs` is the agent skill for Iris users, installed as a plugin
  through `.claude-plugin/`. It teaches the API and how to structure an
  application.
- `tools/tooling` holds the build and release scripts. Editing its build files
  invalidates every Turbo cache.

## Architecture

### IDs

Every ID is a branded 32-bit number: entities, tags, components, relations, and
pairs share one encoded space, and definitions are entities too. Code that works
on entities works on definitions. A pair stores its target without the target's
generation, so a pair left on a dead target would point at whoever recycles that
slot. That is why destroying an entity removes every pair that targets it. Pair
IDs are negative numbers in JavaScript. Check `isPair` before extracting a type
or raw ID.

### Entities

An entity's meta holds its current archetype and row. Destroyed IDs return to a
LIFO freelist with a generation bumped by one, wrapping at 256, so stale-handle
detection is modulo 256. Destruction runs in a fixed order: cascades for pairs
targeting the entity, cleanup of the relation's own pairs, `entityDestroying`
while data is still readable, swap-remove, then `entityDestroyed`. Definitions
join a world lazily on first use, and their IDs are never recycled.

### Archetypes and components

An archetype is a sorted set of types with one column per component, typed
arrays for numeric fields. Adding or removing a component moves the entity, and
every removal swap-moves the last row into the hole, so the moved entity's row
must be patched. Columns grow by reallocation and never shrink. Any view or
typed-array reference is stale after the next structural change or growth.
Writes through `getComponentView` skip change tracking and need
`markComponentChanged`. Empty archetypes live until a type is destroyed.

### Relations

A relation pair works anywhere a component ID does. Wildcard matching is not
query logic: each concrete pair also adds the aggregate columns
`pair(relation, Wildcard)` and `pair(Wildcard, target)`, dropped only when no
sibling pair needs them. Never add or remove wildcard pairs directly. Exclusive
replacement happens in one archetype move. `onDeleteTarget: "delete"` cascades
through the holders, and cycles are guarded. There are at most 256 relations,
including `Wildcard`.

### Resources and definitions

A resource is a component stored on its own definition entity, so a plain query
for that component also matches the resource. Definitions live in a
process-wide registry shared by every world and survive `resetWorld`. Names of
tags, components, relations, and events are unique across the process.
`resetWorld` clears entities, archetypes, queries, names, events, and actions,
and restarts IDs at 1, so handles from before a reset can match new entities.

### Queries and change detection

Queries are cached and walk live storage. Never make structural changes inside
a query callback; take a `collectEntities` snapshot first. `added()` and
`changed()` match nothing outside a running system. Each read consumes its
window up front, so a second read in the same system returns nothing, and an
early stop still discards the rest. Writes mark a change unconditionally,
without comparing values.

### Events and observers

Events are double-buffered and read per system through the same windows.
Outside a system every read returns nothing, while emitting is allowed
anywhere. An event lives for the rest of its frame and the next one. Observers
are synchronous engine hooks for internals and tooling, with unspecified order.
Game logic belongs in systems and events.

### Systems and scheduling

A system is a named function of the world. Each frame runs Startup once, then
the pipeline of schedules, then flushes events. Order within a schedule comes
from before and after constraints, and ties fall back to registration order so
execution stays deterministic. Keep that tiebreak. Constraints never cross
schedules, and validation is deferred to the next frame. Systems added
mid-frame take effect the next frame. Only one frame runs at a time, and
conditions run outside any system. Actions apply immediately; there is no
command buffer.

### React

Hooks use `useSyncExternalStore` over observers. Snapshots must stay
referentially stable, or React re-renders forever. `WorldProvider` tracks a
reset generation, and hooks that memoize depend on it.

## Engineering

- Data and functions. State is plain objects, typed arrays, `Map`, and `Set`.
  Logic is free functions that take `world` first. No classes and no `this`;
  the error hierarchy is the only exception.
- Simplicity first. No abstraction, option, or helper before code needs it.
  Three similar lines beat a premature abstraction. Delete what nothing uses,
  and prefer a smaller public API.
- Performance next. Hot paths use index loops, avoid allocation, and use `!`
  where surrounding logic proves the bound. Run the benchmarks before and after
  changing archetype moves, entity lifecycle, component access, or query
  iteration, on the same machine. Never judge speed with micro-benchmarks.
- Types are part of the API. Full inference, branded IDs, overloads, and
  `asserts` signatures that narrow arguments. If a type cannot be inferred, the
  API design is wrong.
- Errors. Check preconditions at the top of a function and throw a specific
  class from `error.ts`. Never throw a bare `Error`.
- No runtime dependencies in published packages. Unstable API is exported from
  `index.ts` under an `EXPERIMENTAL_` alias.
- Readable code. Separate guard clauses, setup, work, and the return with blank
  lines, so each step reads as a paragraph. Divide modules into regions with
  `// ===` headers. Prefer early returns, short functions, and full words.
- Comments explain why, never what. Write them as short, plain fragments.

## Documentation

Write for a developer who knows ECS but not Iris internals: short sentences,
everyday words, no internals.

- Public API gets JSDoc with a one-line summary in the third person, then only
  facts a caller acts on: idempotence, no-op cases, type narrowing, how long a
  view lives. Add one `{@link}` to the API that completes the workflow,
  `@throws` with its condition, and an `@example`. Skip `@param` and `@returns`
  that only restate the signature. Overloads carry the doc on the first one.
- Internal exports get `@internal` and one to three lines: the role, plus the
  reason a reader cannot see in the code.
- Every claim must trace to code you have read, including callers and tests.
  Wrong documentation is worse than none.
- Update the README in the same change whenever public behavior changes. Match
  its voice, and take examples from the space shooter.
- Update `skills/iris-ecs` in the same change too. Its examples must compile
  against the current API. Never edit the version it names: Prepare release
  stamps it, and the release-policy check rejects a mismatch.

## Testing

A good test proves one behavior through the public contract and could fail. It
is named after that behavior in plain present tense, and it reads as arrange,
act, and assert separated by blank lines.

- Use `node:test` and `node:assert` in the colocated `*.test.ts` file. Each test
  creates its own world.
- The registry is global, so every definition name must be unique within its
  test file. Repeated names get a prefix from the describe block, such as
  `ce_Player`.
- Change detection and events only work inside a system. Register a system,
  mutate, then `await runOnce(world)`.
- Assert errors by class, and check that a rejected call left nothing behind.
- Cover the edges that matter: dead and stale entities, recycled IDs, limits,
  ordering, and `resetWorld`. Do not retest what another test covers or test
  implementation details.
- A bug fix starts with a test that fails without the fix.
- React tests use `renderHook` with a `WorldProvider` wrapper.

## Releases

PR titles become changelog lines, so write them as short imperative sentences
without prefixes. Never bump versions, edit `CHANGELOG.md` or
`.github/release-record.json`, or publish by hand. The Prepare release workflow
does all of it, and CI's release-policy check rejects any version change
without a matching release record.
