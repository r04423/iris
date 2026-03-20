---
name: observers
description: Observers -- registerObserverCallback, unregisterObserverCallback, lifecycle events, synchronous dispatch, when to use vs events/change detection
metadata:
  tags: observer, registerObserverCallback, unregisterObserverCallback, lifecycle, entityCreated, entityDestroyed, componentAdded, componentRemoved, componentChanged, worldReset
---

# Observers

Observers are synchronous lifecycle callbacks. They fire *during* the operation that triggers them -- `componentAdded` fires inside `addComponent`, before `addComponent` returns. This makes them useful for low-level integrations that need to react to structural changes as they happen: devtools, debugging overlays, editor inspectors, metric collection.

Observers are not for game logic. Game logic needs deterministic ordering, per-system isolation, and frame-aligned execution -- that's what systems, events, and change detection provide. Observers fire mid-operation with no ordering guarantees and no system context.

```typescript
import { registerObserverCallback, unregisterObserverCallback } from "iris-ecs";
```

## Registering Callbacks

```typescript
const onEntityCreated = (entityId: Entity) => {
  console.log("entity created:", entityId);
};

registerObserverCallback(world, "entityCreated", onEntityCreated);
```

The callback receives the event's payload arguments directly. TypeScript infers the callback signature from the event type string.

Keep a reference to the callback if you need to unregister it later. Anonymous functions cannot be unregistered.

## Unregistering Callbacks

```typescript
unregisterObserverCallback(world, "entityCreated", onEntityCreated);
```

Pass the exact function reference used during registration. Unregistering a callback that was never registered is a no-op.

## Event Types

| Event Type | Payload | Fires When |
|---|---|---|
| `entityCreated` | `(entityId: Entity)` | `createEntity` -- after entity is registered |
| `entityDestroyed` | `(entityId: EntityId)` | `destroyEntity` -- before entity is removed from registry |
| `componentAdded` | `(componentId: EntityId, entityId: EntityId)` | `addComponent` -- after archetype transition, data available |
| `componentRemoved` | `(componentId: EntityId, entityId: EntityId)` | `removeComponent` -- after archetype transition |
| `componentChanged` | `(componentId: EntityId, entityId: EntityId)` | `setComponentValue` / `markComponentChanged` |
| `archetypeCreated` | `(archetype: Archetype)` | New archetype registered |
| `archetypeDestroyed` | `(archetype: Archetype)` | Archetype destroyed -- fires before cleanup, archetype still accessible |
| `worldReset` | `(world: World)` | `resetWorld` -- after all state is cleared |
| `scheduleStarted` | `(scheduleLabel: ScheduleLabel)` | Before first system in a schedule runs |
| `scheduleFinished` | `(scheduleLabel: ScheduleLabel, duration: number)` | After all systems in a schedule complete |
| `systemStarted` | `(systemId: string, scheduleLabel: ScheduleLabel)` | Before a system runs |
| `systemFinished` | `(systemId: string, scheduleLabel: ScheduleLabel, duration: number)` | After a system completes |

`componentRemoved` also fires for every component on an entity during `destroyEntity`, before the entity itself is removed.

## Dispatch Behavior

Callbacks execute synchronously and in reverse registration order. Reverse iteration means a callback can safely unregister itself during dispatch without affecting other callbacks:

```typescript
const oneShot = (entityId: Entity) => {
  captureFirstEntity(entityId);
  unregisterObserverCallback(world, "entityCreated", oneShot);
};

registerObserverCallback(world, "entityCreated", oneShot);
```

There is no per-entity or per-component filtering. A `componentAdded` callback fires for *every* component addition on *every* entity. Filter inside the callback:

```typescript
registerObserverCallback(world, "componentAdded", (componentId, entityId) => {
  if (componentId !== Health) return;
  logHealthAdded(entityId);
});
```

## Practical Examples

### Debugging: Log Entity Lifecycle

```typescript
registerObserverCallback(world, "entityCreated", (entityId) => {
  console.log("[ecs] entity created:", entityId);
});

registerObserverCallback(world, "entityDestroyed", (entityId) => {
  console.log("[ecs] entity destroyed:", entityId);
});
```

### Performance Profiling

```typescript
registerObserverCallback(world, "systemFinished", (systemId, _schedule, duration) => {
  if (duration > 16) {
    console.warn(`[perf] ${systemId} took ${duration.toFixed(1)}ms (over frame budget)`);
  }
});
```

### Editor Integration: Track Component Changes

```typescript
const inspectedEntity: EntityId = /* entity selected in editor */;

registerObserverCallback(world, "componentChanged", (componentId, entityId) => {
  if (entityId !== inspectedEntity) return;
  refreshInspectorPanel(entityId, componentId);
});
```

## When to Use Observers

Observers are the right tool when:
- You need to react *during* the operation, not next frame (editor property panels, debug logging)
- The callback is infrastructure, not game logic (devtools, serialization hooks, metric collection)
- You need to monitor structural changes across all entities without modifying ECS state

For everything else, use the frame-aligned alternatives:

| Need | Tool |
|---|---|
| "Something happened this frame" (damage, collision, input) | **Event** ([events.md](./events.md)) |
| "Which entities gained a component since my last run" | `added()` query modifier ([change-detection.md](./change-detection.md)) |
| "Which entities had data modified since my last run" | `changed()` query modifier ([change-detection.md](./change-detection.md)) |
| "A component was removed from an entity" | `removed()` event ([change-detection.md](./change-detection.md)) |

## Anti-Patterns

```typescript
// WRONG: game logic in an observer
registerObserverCallback(world, "componentAdded", (componentId, entityId) => {
  if (componentId === Poisoned) {
    const hp = getComponentValue(world, entityId, Health, "current")!;
    setComponentValue(world, entityId, Health, "current", hp - 10);
  }
});

// RIGHT: use a system with change detection
const poisonSystem = defineSystem("poisonSystem", (world) => {
  const newlyPoisoned = cacheQuery(world, added(Poisoned), Health);
  return () => {
    queryEntities(world, newlyPoisoned, (entity) => {
      const hp = getComponentValue(world, entity, Health, "current");
      setComponentValue(world, entity, Health, "current", hp - 10);
    });
  };
});
```

**Why:** Observer callbacks fire mid-operation with no system context. Mutating component values inside an observer can trigger nested observer dispatches, and the execution order depends on registration order rather than the schedule. Systems run in a deterministic order defined by the schedule, and `added()` gives per-system tracking so each system sees the change independently.

## See Also

- [events.md](./events.md) -- deferred, double-buffered inter-system messages
- [change-detection.md](./change-detection.md) -- `added()`, `changed()`, `removed()` for per-system change tracking
- [systems.md](./systems.md) -- deterministic, schedule-ordered game logic
- [components.md](./components.md) -- `addComponent`, `removeComponent`, `setComponentValue` (operations that fire observers)
