# iris-react

React bindings for Iris ECS.

> **Early stage implementation.** APIs are unstable and breaking changes can happen between versions.

## Why React Bindings?

Iris ECS stores all application state in a high-performance columnar format. React applications that consume this state need a way to subscribe to changes without polling, without breaking concurrent rendering guarantees, and without coupling ECS internals to component trees.

## Install

```bash
npm install iris-react iris-ecs react
```

`iris-ecs` and `react` (>=18) are peer dependencies.

## Quick Start

```tsx
import {
  createWorld,
  createEntity,
  defineComponent,
  defineTag,
  defineActions,
  addComponent,
  Type,
} from "iris-ecs";
import { WorldProvider, useQueryEntities, useComponentValue, useActions } from "iris-react";

// Define components
const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });
const Enemy = defineTag("Enemy");

// Create world and initial entities
const world = createWorld();

const enemy = createEntity(world);
addComponent(world, enemy, Enemy);
addComponent(world, enemy, Position, { x: 10, y: 20 });

// Define reusable actions
const spawnActions = defineActions((world) => ({
  spawnEnemy(x: number, y: number) {
    const e = createEntity(world);
    addComponent(world, e, Enemy);
    addComponent(world, e, Position, { x, y });
    return e;
  },
}));

// Mount the provider at the root
function App() {
  return (
    <WorldProvider world={world}>
      <EnemyList />
      <SpawnButton />
    </WorldProvider>
  );
}

// Query entities reactively
function EnemyList() {
  const enemies = useQueryEntities(Enemy, Position);
  return (
    <ul>
      {enemies.map((id) => (
        <EnemyRow key={id} entity={id} />
      ))}
    </ul>
  );
}

// Read component values reactively
function EnemyRow({ entity }: { entity: EntityId }) {
  const x = useComponentValue(entity, Position, "x");
  const y = useComponentValue(entity, Position, "y");
  return <li>Enemy at ({x}, {y})</li>;
}

// Use actions for mutations
function SpawnButton() {
  const { spawnEnemy } = useActions(spawnActions);
  return <button onClick={() => spawnEnemy(0, 0)}>Spawn</button>;
}
```

## API Reference

### `WorldProvider`

Provides an Iris ECS world to the React component tree. Registers a `worldReset` observer internally so descendant hooks invalidate memoized state when `resetWorld()` is called.

```tsx
import { WorldProvider } from "iris-react";
import { createWorld } from "iris-ecs";

const world = createWorld();

function App() {
  return (
    <WorldProvider world={world}>
      <Game />
    </WorldProvider>
  );
}
```

Mount a single `WorldProvider` at the app root. All hooks below must be called within this provider.

### `useWorld()`

Returns the `World` instance from the nearest `WorldProvider`. Throws if called outside one.

```tsx
import { useWorld } from "iris-react";

function DebugPanel() {
  const world = useWorld();
  return <pre>{world.entities.byId.size} entities</pre>;
}
```

💡 **Tip:** Prefer reactive hooks (`useComponentValue`, `useQueryEntities`) for values that drive rendering. Use `useWorld()` for imperative operations like emitting events.

### `useActions(getter)`

Returns the cached actions object for the current world. Actions are created once per world and cached -- safe to destructure in render.

```tsx
import { useActions } from "iris-react";
import { defineActions, createEntity, addComponent } from "iris-ecs";

const spawnActions = defineActions((world) => ({
  spawnEnemy(x: number, y: number) {
    const e = createEntity(world);
    addComponent(world, e, Position, { x, y });
    return e;
  },
}));

function SpawnButton() {
  const { spawnEnemy } = useActions(spawnActions);
  return <button onClick={() => spawnEnemy(0, 0)}>Spawn</button>;
}
```

### `useComponentValue(entity, component, field)`

Returns a single field value from a component on an entity, updating reactively when the component changes. Returns `undefined` if the entity doesn't have the component.

```tsx
import { useComponentValue } from "iris-react";

function HealthBar({ entity }: { entity: EntityWith<typeof Health> }) {
  const hp = useComponentValue(entity, Health, "current");
  const max = useComponentValue(entity, Health, "max");
  return <div style={{ width: `${((hp ?? 0) / (max ?? 1)) * 100}%` }} />;
}
```

One hook per field. For multiple fields, call the hook multiple times. This keeps each subscription targeted -- a change to `Health.current` won't re-render a component that only reads `Health.max`.

Supports typed pairs from relations:

```tsx
const damage = useComponentValue(entity, pair(DamageOver, target), "amount");
```

💡 **Tip:** Primitive values (numbers, strings, booleans) get free `Object.is` stability -- React skips re-renders when the value hasn't actually changed.

### `useComponentEffect(entity, component, callback)`

Registers a side-effect callback that fires when a component changes on the given entity. The callback can return a cleanup function, mirroring `useEffect` semantics.

```tsx
import { useComponentEffect } from "iris-react";

function DamageFlash({ entity }: { entity: EntityWith<typeof Health> }) {
  const [flash, setFlash] = useState(false);

  useComponentEffect(entity, Health, () => {
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 200);
    return () => clearTimeout(timer);
  });

  return <div className={flash ? "flash" : ""} />;
}
```

💡 **Tip:** Use `useComponentEffect` for side effects (animations, sounds). For reading values, prefer `useComponentValue`.

### `useHasComponent(entity, component)`

Returns whether an entity has a given component, tag, or pair. Updates when the component is added or removed.

```tsx
import { useHasComponent } from "iris-react";

function ShieldIndicator({ entity }: { entity: EntityId }) {
  const hasShield = useHasComponent(entity, Shield);
  if (!hasShield) return null;
  return <div className="shield-icon" />;
}
```

### `useQueryEntities(...terms)`

Returns a reactive array of entities matching the given query terms. Updates when entities enter or leave the query due to component additions, removals, or entity destruction.

Supports component IDs and `not()` modifiers:

```tsx
import { useQueryEntities } from "iris-react";
import { not } from "iris-ecs";

function EnemyList() {
  const enemies = useQueryEntities(Enemy, Position, not(Dead));
  return (
    <ul>
      {enemies.map((id) => (
        <EnemyRow key={id} entity={id} />
      ))}
    </ul>
  );
}
```

The returned array reference is stable when contents haven't changed -- safe to use as a dependency or pass to child components without causing unnecessary re-renders.

### `useQueryFirstEntity(...terms)`

Returns the first entity matching the given query terms, or `undefined` if no entities match. Thin wrapper around `useQueryEntities`.

```tsx
import { useQueryFirstEntity } from "iris-react";

function PlayerHUD() {
  const player = useQueryFirstEntity(Player, Health);
  if (!player) return null;
  return <HealthBar entity={player} />;
}
```

## License

MIT
