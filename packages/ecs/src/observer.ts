import type { Archetype } from "./archetype.js";
import type { Entity, EntityId } from "./encoding.js";
import type { FilterMeta } from "./filters.js";
import type { ScheduleLabel } from "./scheduler.js";
import type { World } from "./world.js";

// ============================================================================
// Observer Types
// ============================================================================

/**
 * Maps each observer event type to its callback argument tuple.
 *
 * The tuple is spread into the callback, so a `componentAdded` observer
 * receives `(componentId, entityId)` -- component first, entity second.
 */
export type EventPayloads = {
  archetypeCreated: [archetype: Archetype];
  archetypeDestroyed: [archetype: Archetype];
  filterCreated: [filter: FilterMeta];
  entityCreated: [entityId: Entity];
  entityDestroying: [entityId: EntityId];
  entityDestroyed: [entityId: EntityId];
  componentAdded: [componentId: EntityId, entityId: EntityId];
  componentRemoved: [componentId: EntityId, entityId: EntityId];
  componentChanged: [componentId: EntityId, entityId: EntityId];
  worldReset: [world: World];
  scheduleStarted: [scheduleLabel: ScheduleLabel];
  scheduleFinished: [scheduleLabel: ScheduleLabel, duration: number];
  systemStarted: [systemId: string, scheduleLabel: ScheduleLabel];
  systemFinished: [systemId: string, scheduleLabel: ScheduleLabel, duration: number];
  frameFailed: [error: unknown];
};

/**
 * Name of an observer event type, e.g. `"componentAdded"`.
 */
export type EventType = keyof EventPayloads;

/**
 * Callback invoked synchronously when its event type fires.
 *
 * Registered with {@link registerObserverCallback}; the arguments follow
 * {@link EventPayloads} for the event type.
 */
export type Observer<T extends EventType> = (...args: EventPayloads[T]) => void;

/**
 * Registered callbacks for one observer event type.
 */
export type ObserverMeta<T extends EventType> = {
  /** Callbacks fired on event. */
  callbacks: Observer<T>[];
};

// ============================================================================
// Observer State
// ============================================================================

/**
 * Callback lists per observer event type.
 * @internal
 */
export type ObserverState = {
  [K in EventType]: ObserverMeta<K>;
};

/**
 * Creates an observer registry with empty callback lists for every event type.
 * @internal
 */
export function createObserverState(): ObserverState {
  return {
    archetypeCreated: { callbacks: [] },
    archetypeDestroyed: { callbacks: [] },
    filterCreated: { callbacks: [] },
    entityCreated: { callbacks: [] },
    entityDestroying: { callbacks: [] },
    entityDestroyed: { callbacks: [] },
    componentAdded: { callbacks: [] },
    componentRemoved: { callbacks: [] },
    componentChanged: { callbacks: [] },
    worldReset: { callbacks: [] },
    scheduleStarted: { callbacks: [] },
    scheduleFinished: { callbacks: [] },
    systemStarted: { callbacks: [] },
    systemFinished: { callbacks: [] },
    frameFailed: { callbacks: [] },
  };
}

// ============================================================================
// Observer API
// ============================================================================

/**
 * Registers a callback for a lifecycle event type.
 *
 * Observers are low-level hooks that power internals like query filter caches
 * and removal detection -- for gameplay communication between systems, use
 * events via `emitEvent()` and `readEvents()` instead. Callbacks fire
 * synchronously inside the triggering operation (e.g. `componentAdded` fires
 * during `addComponent()`, after the data is written) and survive
 * `resetWorld()`. Remove with {@link unregisterObserverCallback}.
 *
 * Dispatch order is unspecified: a callback must not rely on observing the
 * effects of another callback for the same event. During dispatch, a callback
 * may unregister itself but must not register or unregister other callbacks
 * for the event being dispatched.
 *
 * @example
 * ```typescript
 * registerObserverCallback(world, "componentAdded", (componentId, entityId) => {
 *   if (componentId === Health) {
 *     console.log(`Health added to entity ${entityId}`);
 *   }
 * });
 * ```
 */
export function registerObserverCallback<T extends EventType>(world: World, eventType: T, callback: Observer<T>): void {
  world.observers[eventType].callbacks.push(callback);
}

/**
 * Removes a previously registered observer callback.
 *
 * Matches by reference; unknown callbacks are ignored. A callback may
 * unregister itself during dispatch, but unregistering any other callback for
 * the event currently being dispatched leads to undefined behavior.
 *
 * @param callback - The exact callback reference passed to {@link registerObserverCallback}
 *
 * @example
 * ```typescript
 * const onAdded = (componentId: EntityId, entityId: EntityId) => {};
 * registerObserverCallback(world, "componentAdded", onAdded);
 * // Later:
 * unregisterObserverCallback(world, "componentAdded", onAdded);
 * ```
 */
export function unregisterObserverCallback<T extends EventType>(
  world: World,
  eventType: T,
  callback: Observer<T>
): void {
  const meta = world.observers[eventType];
  const idx = meta.callbacks.indexOf(callback);

  if (idx !== -1) {
    meta.callbacks.splice(idx, 1);
  }
}

/**
 * Dispatches an event synchronously to every registered callback.
 * @internal
 */
export function fireObserverEvent<T extends EventType>(world: World, eventType: T, ...args: EventPayloads[T]): void {
  const meta = world.observers[eventType];

  // Iterate in reverse so callbacks can safely unregister themselves during dispatch
  for (let i = meta.callbacks.length - 1; i >= 0; i--) {
    meta.callbacks[i]!(...args);
  }
}
