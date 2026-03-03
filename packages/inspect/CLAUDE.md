# iris-inspect

DevTools panel for Iris ECS. Visual inspection of ECS world state.

## Architecture
 
Three layers, each independently testable:

1. **Bridge** (`bridge.ts`) -- Observer callbacks sync World-to-Zustand store. No polling. Returns a cleanup function that unregisters all observers.
2. **Store** (`store.ts`) -- Zustand vanilla store (`zustand/vanilla`). Bridge writes via `store.getState()._action()`. React reads via `useStore(store, selector)`.
3. **UI** (`components/`) -- Thin React components. Only read store via selectors. No direct ECS access.

```
World → Bridge → Store → React components
         ↑                    ↑
    observer callbacks    useStore(selector)
```

## Module Overview

| Module | Responsibility |
|--------|----------------|
| `index.ts` | Public API: `attachDevTools(world)` -> `DevToolsHandle` |
| `types.ts` | `EntitySnapshot`, `PanelId`, `DevToolsState` |
| `store.ts` | Zustand vanilla store factory (bridge writes, React reads) |
| `bridge.ts` | Observer wiring + initial snapshot + entity classification |
| `lib/filter-entities.ts` | Pure search function (name substring / ID prefix) |
| `lib/inject-styles.ts` | `<style>` tag injection into shadow root |
| `lib/utils.ts` | `cn()` class name utility (clsx + tailwind-merge) |
| `ui/` | shadcn base components (Button, Input, ScrollArea) |
| `components/` | DevTools-specific components (root, header, entity list, entity row) |

## UI Components -- shadcn-first

**ALWAYS install shadcn primitives first, then adjust.** Never hand-write components that shadcn provides.

```bash
# Install from the shadcn registry:
npx shadcn@latest add <component-name> --yes --overwrite
```

Components in `ui/` are installed via `npx shadcn@latest add` using the config in `components.json`. After installation:
1. Fix import paths (`src/lib/utils` -> relative `../lib/utils.js`)
2. Customize colors/sizing to fit the DevTools context
3. Do NOT rewrite from scratch -- shadcn handles accessibility, keyboard nav, and Radix integration

## Code Patterns

**Store is the single source of truth** -- Bridge writes snapshots into the store. React components read from the store via selectors. Components never access `world` directly.

**Bridge actions are prefixed with `_`** -- `_addEntity`, `_removeEntity`, `_reset`, etc. These are internal; UI components use public actions like `setExpanded`, `setSearchQuery`.

**Store passes through props, not context** -- The store instance is passed as a `store` prop from `DevToolsRoot` down to panels. Components use `useStore(store, selector)` for reads. No React context provider.

**Tailwind CSS v4 prefix** -- All classes use the `idt` prefix (e.g. `idt:flex`, `hover:idt:bg-accent`). Tailwind v4 prefixes must be lowercase a-z only (no hyphens). Variant modifiers come before the prefix: `hover:idt:bg-accent`.

**Use shadcn semantic color tokens** -- Use `background`, `foreground`, `muted`, `muted-foreground`, `border`, `primary`, `accent`, etc. from `styles.css @theme`. Do NOT invent custom color tokens -- stay within the shadcn color system so components are visually consistent.

**Shadow DOM isolation** -- `attachDevTools` renders inside a shadow root (`mode: "open"`). This prevents styles from leaking in either direction between the DevTools and the host app.

**Cleanup is symmetric** -- `attachDevTools` returns `{ destroy, store }`. `destroy()` unmounts React, removes host element (including shadow root), detaches bridge observers -- in that order.

## Relationship with iris-ecs

iris-inspect is a first-party consumer of iris-ecs. If DevTools needs functionality that iris-ecs doesn't publicly export, the correct approach is to add proper public exports to iris-ecs -- not to work around the API boundary with heuristics.

**iris-ecs MUST NOT be bundled** -- bundling it would create a duplicate registry, breaking component identity checks. It is listed as `peerDependencies` and marked `external` in Vite config.

## Build

Vite library mode. React, Zustand, Radix, clsx, tailwind-merge, class-variance-authority are all **bundled** into the output. Only iris-ecs is external. Output: `dist/iris-inspect.js` (self-contained) + `dist/index.d.ts`.

## Testing

`pnpm test` runs bridge and filter logic tests via `node:test` + `tsx`.

React components are thin store selectors -- not unit tested. Test the logic layers (bridge, filter), skip rendering.
