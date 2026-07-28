import type { Archetype } from "./archetype.js";
import type { Entity, EntityId } from "./encoding.js";
import type { FilterMeta } from "./filters.js";
import type { ScheduleLabel } from "./scheduler.js";
import type { World } from "./world.js";

// ============================================================================
// Observer Types
// ============================================================================

/**
 * Event payload type mapping.
 *
 * Maps event names to argument tuples for type-safe observer callbacks.
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
 * Event type keys.
 */
export type EventType = keyof EventPayloads;

/**
 * Observer callback function.
 */
export type Observer<T extends EventType> = (...args: EventPayloads[T]) => void;

/**
 * Observer metadata for single event type.
 */
export type ObserverMeta<T extends EventType> = {
  /**
   * Callbacks fired on event.
   */
  callbacks: Observer<T>[];
};

// ============================================================================
// Observer State
// ============================================================================

/**
 * Observer system for lifecycle events.
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
 * Registers a callback to be invoked when an event of the specified type is fired.
 *
 * Dispatch order is unspecified: a callback must not rely on observing the effects of
 * another callback for the same event.
 *
 * During observer dispatch, a callback may unregister itself but must not
 * register or unregister other callbacks for the event being dispatched.
 *
 * @param world - The world instance containing observer state
 * @param eventType - The event type to listen for
 * @param callback - Function to invoke when the event fires
 *
 * @example
 * ```ts
 * registerObserverCallback(world, "onAdd", (entity, componentId, value) => {
 *   console.log(`Component ${componentId} added to entity ${entity}`);
 * });
 * ```
 */
export function registerObserverCallback<T extends EventType>(world: World, eventType: T, callback: Observer<T>): void {
  world.observers[eventType].callbacks.push(callback);
}

/**
 * Removes a previously registered callback for the specified event type.
 *
 * A callback may unregister itself during dispatch. Registering or
 * unregistering any other callback for the event currently being dispatched can
 * lead to an undefined behavior.
 *
 * @param world - The world instance containing observer state
 * @param eventType - The event type to stop listening for
 * @param callback - The exact callback reference to remove
 *
 * @example
 * ```ts
 * const handler = (entity, componentId, value) => { ... };
 * registerObserverCallback(world, "onAdd", handler);
 * // Later:
 * unregisterObserverCallback(world, "onAdd", handler);
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
 * Dispatches an event to all registered callbacks for the specified event type.
 *
 * @param world - The world instance containing observer state
 * @param eventType - The event type to dispatch
 * @param args - Arguments to pass to each callback (varies by event type)
 *
 * @example
 * ```ts
 * fireObserverEvent(world, "onAdd", entity, componentId, componentValue);
 * ```
 */
export function fireObserverEvent<T extends EventType>(world: World, eventType: T, ...args: EventPayloads[T]): void {
  const meta = world.observers[eventType];

  // Iterate in reverse so callbacks can safely unregister themselves during dispatch
  for (let i = meta.callbacks.length - 1; i >= 0; i--) {
    meta.callbacks[i]!(...args);
  }
}
