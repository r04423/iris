import type { Archetype } from "./archetype.js";
import type { Entity, EntityId } from "./encoding.js";
import type { FilterMeta } from "./filters.js";
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
  filterDestroyed: [filter: FilterMeta];
  entityCreated: [entityId: Entity];
  entityDestroyed: [entityId: EntityId];
  componentAdded: [componentId: EntityId, entityId: EntityId];
  componentRemoved: [componentId: EntityId, entityId: EntityId];
  componentChanged: [componentId: EntityId, entityId: EntityId];
  worldReset: [world: World];
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
// Observer API
// ============================================================================

/**
 * Registers a callback to be invoked when an event of the specified type is fired.
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
