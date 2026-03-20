---
name: events
description: Events -- defineEvent, emitEvent, readEvents, collectEvents, readLastEvent, hasEvents, countEvents, clearEvents, removed(), double buffering, system context
metadata:
  tags: event, defineEvent, emitEvent, readEvents, collectEvents, readLastEvent, hasEvents, countEvents, clearEvents, removed
---

# Events

Events are ephemeral messages for inter-system communication. They survive one frame, then they're gone. Use events for things that *happened* -- a collision, a level-up, a damage hit. If the data needs to persist beyond the frame it was produced, it belongs in a component, not an event.

```typescript
import {
  defineEvent, emitEvent, readEvents, collectEvents,
  readLastEvent, hasEvents, countEvents, clearEvents,
  removed, Type,
} from "iris-ecs";
```

## Defining Events

### Tag Events (no data)

```typescript
const GameStarted = defineEvent("GameStarted");
const WaveComplete = defineEvent("WaveComplete");
```

Tag events carry no payload. `emitEvent` takes no data argument.

### Data Events

```typescript
const DamageDealt = defineEvent("DamageDealt", {
  source: Type.u32(),
  target: Type.u32(),
  amount: Type.f32(),
});

const ScoreChanged = defineEvent("ScoreChanged", {
  player: Type.u32(),
  delta: Type.i32(),
});
```

Data events carry a typed payload matching the schema. See [schema.md](./schema.md) for `Type.*` factories.

Define events at module scope. Each `defineEvent` call allocates a unique ID.

## Emitting Events

```typescript
emitEvent(world, GameStarted);
emitEvent(world, DamageDealt, { source: attacker, target: defender, amount: 25 });
```

`emitEvent` works anywhere -- inside systems, outside systems, during setup. No restrictions.

Tag events take no data argument. Data events require an object matching the schema. TypeScript enforces both.

## Reading Events

All read functions require **system context** -- they return empty results outside a system's tick.

### `readEvents` -- Callback Iteration

```typescript
const damageSystem = defineSystem("damageSystem", (world) => {
  return () => {
    readEvents(world, DamageDealt, ({ source, target, amount }) => {
      const hp = getComponentValue(world, target, Health, "current")!;
      setComponentValue(world, target, Health, "current", hp - amount);
    });
  };
});
```

Iterates each unread event and marks them as read. Return `false` from the callback to stop early.

### `collectEvents` -- Array

```typescript
const events = collectEvents(world, DamageDealt);
for (let i = 0; i < events.length; i++) {
  applyDamage(events[i]!.target, events[i]!.amount);
}
```

Returns an array of unread event data. Allocates a new array every call -- prefer `readEvents` in systems that run every frame. Use `collectEvents` when you need random access or need to pass results to non-ECS code.

### `readLastEvent` -- Most Recent Only

```typescript
const last = readLastEvent(world, ScoreChanged);
if (last) {
  updateScoreboard(last.player, last.delta);
}
```

Returns the most recent unread event, or `undefined` if none. Marks *all* unread events as read, not just the one returned. Use when only the latest state matters -- input changes, configuration updates, latest mouse position.

### Type Narrowing with `hasEvents`

`hasEvents` is a type predicate. After a `hasEvents` check, `readLastEvent` returns non-null:

```typescript
if (hasEvents(world, DamageDealt)) {
  const last = readLastEvent(world, DamageDealt); // guaranteed non-undefined
  showDamageNumber(last.target, last.amount);
}
```

`hasEvents` does not mark events as read. Call it multiple times without side effects.

### `countEvents`

```typescript
const hits = countEvents(world, DamageDealt);
if (hits > 5) {
  emitEvent(world, ComboAchieved);
}
```

Returns the number of unread events. Does not mark events as read.

### `clearEvents` -- Skip Without Processing

```typescript
if (isPaused) {
  clearEvents(world, DamageDealt);
  return;
}
```

Marks events as read without invoking a callback. Use to skip events under conditions like pause, disable, or cooldowns.

## Per-System Isolation

Each system tracks event consumption independently. Two systems reading the same event type both see the full set of unread events:

```typescript
const damageSystem = defineSystem("damageSystem", (world) => {
  return () => {
    readEvents(world, DamageDealt, ({ target, amount }) => {
      // this system applies damage
      const hp = getComponentValue(world, target, Health, "current")!;
      setComponentValue(world, target, Health, "current", hp - amount);
    });
  };
});

const audioSystem = defineSystem("audioSystem", (world) => {
  return () => {
    readEvents(world, DamageDealt, ({ amount }) => {
      // this system plays hit sounds -- sees the same events
      playSound(amount > 50 ? "heavy_hit" : "light_hit");
    });
  };
});
```

## Double Buffering

Events are double-buffered. `emitEvent` writes to the current buffer. At the end of each tick, current and previous buffers swap. The previous buffer (now holding last frame's events) survives one more frame, then is cleared.

This means an event emitted in frame N is readable in frames N and N+1, then gone.

Events emitted during iteration are not visible in the same read pass. They'll be readable next time the system runs.

## Removal Detection

`removed()` returns an event that fires when a component is removed from any entity. See [change-detection.md](./change-detection.md) for the full removal detection API, including `added()` and `changed()`.

## When to Use Events

Events are for **ephemeral data** -- things that happened this frame. They are not storage. If a system needs to check whether damage occurred three frames ago, that information belongs in a component.

- "Something happened" (collision, input action, level-up) -- **Event**
- "Which entities had their data modified since my last run" -- `changed()` query modifier ([change-detection.md](./change-detection.md))
- "Which entities just gained a component" -- `added()` query modifier ([change-detection.md](./change-detection.md))
- "A component was removed" -- `removed()` event
- "I need to react immediately, not next frame" -- **Observer** ([observers.md](./observers.md))
- Data needs to persist beyond the frame it was produced -- **Component** ([components.md](./components.md))

## Anti-Patterns

```typescript
// WRONG: reading events outside system context (callback is never invoked)
readEvents(world, DamageDealt, ({ target, amount }) => {
  applyDamage(target, amount); // never runs
});

// RIGHT: read inside a system tick
const damageSystem = defineSystem("damageSystem", (world) => {
  return () => {
    readEvents(world, DamageDealt, ({ target, amount }) => {
      applyDamage(target, amount);
    });
  };
});
```

**Why:** `readEvents`, `hasEvents`, `countEvents`, `collectEvents`, `readLastEvent`, and `clearEvents` all require system context. Outside a system tick, the execution context has no system ID, so reads silently return empty.

---

```typescript
// WRONG: using events to store persistent state
const DamageLog = defineEvent("DamageLog", {
  target: Type.u32(),
  amount: Type.f32(),
});

// emit damage, then try to read it several frames later -- gone
emitEvent(world, DamageLog, { target: enemy, amount: 30 });

// RIGHT: store persistent data in a component
const DamageHistory = defineComponent("DamageHistory", {
  totalReceived: Type.f32(),
  lastHitAmount: Type.f32(),
});
```

**Why:** Events survive one frame cycle. Any system that doesn't read the event in the same or next frame misses it permanently. Persistent per-entity data belongs in a component.

---

```typescript
// WRONG: removed() used as a query filter
queryEntities(world, [removed(Health)], (entity) => { /* won't work */ });

// RIGHT: removed() returns an event -- read it with readEvents
readEvents(world, removed(Health), ({ entity }) => {
  playDeathAnimation(entity);
});
```

**Why:** `removed()` returns an `Event`, not a query modifier. Use `readEvents` to consume removal events. For query-time filtering, use `added()` and `changed()` ([change-detection.md](./change-detection.md)).

## See Also

- [change-detection.md](./change-detection.md) -- `added()`, `changed()` query modifiers and `removed()` as an event
- [observers.md](./observers.md) -- immediate lifecycle callbacks (fire during the operation, not deferred)
- [systems.md](./systems.md) -- system context and init/tick separation
- [schema.md](./schema.md) -- `Type.*` factories for data event schemas
- [components.md](./components.md) -- persistent per-entity data (use instead of events when data must outlive the frame)
