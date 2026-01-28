import type { Schema, SchemaRecord } from "./schema.js";
import type { World } from "./world.js";

// ============================================================================
// Event Branded Types
// ============================================================================

/**
 * Event ID brand for nominal typing.
 */
declare const EVENT_BRAND: unique symbol;

/**
 * Event schema brand for carrying schema type in Event.
 */
declare const EVENT_SCHEMA_BRAND: unique symbol;

// ============================================================================
// Event Types
// ============================================================================

/**
 * Event schema type.
 *
 * Maps field names to their schema definitions (same as component schema).
 */
export type EventSchema = SchemaRecord;

/**
 * Event data type inference.
 *
 * - Empty schema {} -> undefined (tag event)
 * - Non-empty schema -> resolved data object
 */
export type EventData<T extends EventSchema> = keyof T extends never
  ? undefined
  : { [K in keyof T]: T[K] extends Schema<infer U> ? U : never };

/**
 * Event ID (branded type).
 *
 * Nominal type for events defined via defineEvent().
 */
export type EventId<S extends EventSchema = EventSchema> = number & {
  [EVENT_BRAND]: true;
  [EVENT_SCHEMA_BRAND]: S;
};

/**
 * Event definition.
 *
 * Global event definition with schema for type-safe event data.
 */
export type Event<S extends EventSchema = EventSchema> = {
  /**
   * Unique event ID.
   */
  readonly id: EventId<S>;
  /**
   * Event name (user-defined).
   */
  readonly name: string;
  /**
   * Field schemas for event data (empty for tag events).
   */
  readonly schema: S;
};

/**
 * Internal event entry with tick.
 *
 * Stores event data along with the tick it was emitted at.
 */
export type EventEntry<T extends EventSchema = EventSchema> = {
  /**
   * Event data (undefined for tag events).
   */
  data: EventData<T>;
  /**
   * Tick when event was emitted.
   */
  tick: number;
};

/**
 * Per-world event queue metadata.
 */
export type EventQueueMeta<T extends EventSchema = EventSchema> = {
  /**
   * Event definition reference.
   */
  event: Event<T>;
  /**
   * Queue of event entries.
   */
  events: EventEntry<T>[];
  /**
   * Execution tick tracking for event consumption.
   */
  lastTick: {
    /**
     * Tick when events last consumed outside any system.
     */
    self: number;
    /**
     * Per-system consumption ticks: systemId -> tick
     */
    bySystemId: Map<string, number>;
  };
};

// ============================================================================
// Constants
// ============================================================================

/**
 * Number of ticks before events expire.
 *
 * Events persist for this many ticks to ensure systems can read regardless
 * of execution order.
 */
export const EVENT_EXPIRY_TICKS = 2;

// ============================================================================
// Global Event Registry
// ============================================================================

/**
 * Event registry type.
 *
 * Global singleton storing all event definitions.
 */
type EventRegistry = {
  /**
   * Event definitions by ID.
   */
  byId: Map<EventId, Event>;

  /**
   * Next raw ID to allocate.
   */
  nextId: number;
};

/**
 * Global event registry singleton.
 */
const EVENT_REGISTRY: EventRegistry = {
  byId: new Map(),
  nextId: 0,
};

// ============================================================================
// Event Definition
// ============================================================================

/**
 * Define event type.
 *
 * Allocates unique event ID with optional schema for type-safe event data.
 * Tag events (no schema) use void for data type - emit() requires no data argument.
 *
 * @param name - Event name for debugging
 * @param schema - Optional field schema record (omit for tag events)
 * @returns Event definition
 *
 * @example
 * ```typescript
 * // Tag event (no data)
 * const GameStarted = defineEvent("GameStarted");
 * emit(world, GameStarted); // No data argument
 *
 * // Data event
 * const DamageDealt = defineEvent("DamageDealt", {
 *   target: Type.u32(),
 *   amount: Type.f32(),
 * });
 * emit(world, DamageDealt, { target: enemy, amount: 25 });
 * ```
 */
export function defineEvent<S extends EventSchema = Record<never, never>>(name: string, schema?: S): Event<S> {
  const id = EVENT_REGISTRY.nextId++ as EventId<S>;

  const event: Event<S> = {
    id,
    name,
    schema: schema ?? ({} as S),
  };

  EVENT_REGISTRY.byId.set(id, event as Event);

  return event;
}

// ============================================================================
// Per-World Event Queue Management
// ============================================================================

/**
 * Ensure event queue exists for given event in world.
 *
 * Creates queue lazily on first access (emit or fetch).
 *
 * @param world - World instance
 * @param event - Event definition
 * @returns Event queue metadata
 */
export function ensureEventQueue<S extends EventSchema>(world: World, event: Event<S>): EventQueueMeta<S> {
  let queue = world.events.byId.get(event.id);

  if (!queue) {
    queue = {
      event: event as Event,
      events: [],
      lastTick: {
        self: 0,
        bySystemId: new Map(),
      },
    };

    world.events.byId.set(event.id, queue);
  }

  return queue as EventQueueMeta<S>;
}

// ============================================================================
// Event Emission
// ============================================================================

/**
 * Emit event to world.
 *
 * Tag events (empty schema) require no data argument.
 * Data events require data matching the schema.
 *
 * @param world - World instance
 * @param event - Event definition
 * @param args - Event data (only for data events)
 */
export function emitEvent<S extends EventSchema>(
  world: World,
  event: Event<S>,
  ...args: keyof S extends never ? [] : [data: EventData<S>]
): void {
  const queue = ensureEventQueue(world, event);
  const data = args[0] as EventData<S>;
  const tick = world.execution.tick;

  queue.events.push({ data, tick });
}

// ============================================================================
// Event Reading
// ============================================================================

/**
 * Update lastTick for current execution context.
 *
 * Internal helper shared by fetchEvents, fetchLastEvent, and clearEvents.
 *
 * @param world - World instance
 * @param queue - Event queue metadata
 */
function markEventsRead(world: World, queue: EventQueueMeta): void {
  const { systemId, tick } = world.execution;

  if (systemId === null) {
    queue.lastTick.self = tick;
  } else {
    queue.lastTick.bySystemId.set(systemId, tick);
  }
}

/**
 * Remove expired events from queue.
 *
 * Events older than EVENT_EXPIRY_TICKS are removed to prevent unbounded growth.
 *
 * @param world - World instance
 * @param queue - Event queue metadata
 */
function cleanupExpiredEvents(world: World, queue: EventQueueMeta): void {
  const expiryTick = world.execution.tick - EVENT_EXPIRY_TICKS;

  // Find first non-expired index
  let firstValidIndex = 0;
  while (firstValidIndex < queue.events.length && queue.events[firstValidIndex]!.tick <= expiryTick) {
    firstValidIndex++;
  }

  // Remove expired events from front
  if (firstValidIndex > 0) {
    queue.events.splice(0, firstValidIndex);
  }
}

/**
 * Fetch events emitted since last call.
 *
 * Per-system isolated: each system has independent tracking of which events
 * it has consumed. Multiple systems can consume the same events independently.
 *
 * @param world - World instance
 * @param event - Event definition
 * @returns Generator yielding event data
 *
 * @example
 * ```typescript
 * for (const event of fetchEvents(world, DamageDealt)) {
 *   applyDamage(event.target, event.amount);
 * }
 * ```
 */
export function* fetchEvents<S extends EventSchema>(world: World, event: Event<S>): Generator<EventData<S>> {
  const queue = ensureEventQueue(world, event);
  const { systemId, tick } = world.execution;

  // Get lastTick for this execution context
  const lastTick = systemId === null ? queue.lastTick.self : (queue.lastTick.bySystemId.get(systemId) ?? 0);

  try {
    for (let i = 0; i < queue.events.length; i++) {
      const entry = queue.events[i]!;
      // Event must have been emitted AFTER lastTick but AT or BEFORE current tick
      if (entry.tick > lastTick && entry.tick <= tick) {
        yield entry.data;
      }
    }
  } finally {
    markEventsRead(world, queue);
    cleanupExpiredEvents(world, queue);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if there are unread events for current context.
 *
 * Does not mark events as read or trigger cleanup.
 *
 * @param world - World instance
 * @param event - Event definition
 * @returns True if unread events exist
 *
 * @example
 * ```typescript
 * if (hasEvents(world, DamageDealt)) {
 *   // Process damage events
 * }
 * ```
 */
export function hasEvents<S extends EventSchema>(world: World, event: Event<S>): boolean {
  const queue = ensureEventQueue(world, event);
  const { systemId, tick } = world.execution;
  const lastTick = systemId === null ? queue.lastTick.self : (queue.lastTick.bySystemId.get(systemId) ?? 0);

  for (let i = 0; i < queue.events.length; i++) {
    const entry = queue.events[i]!;
    if (entry.tick > lastTick && entry.tick <= tick) {
      return true;
    }
  }

  return false;
}

/**
 * Count unread events for current context.
 *
 * Does not mark events as read or trigger cleanup.
 *
 * @param world - World instance
 * @param event - Event definition
 * @returns Number of unread events
 *
 * @example
 * ```typescript
 * const damageCount = countEvents(world, DamageDealt);
 * console.log(`${damageCount} damage events this tick`);
 * ```
 */
export function countEvents<S extends EventSchema>(world: World, event: Event<S>): number {
  const queue = ensureEventQueue(world, event);
  const { systemId, tick } = world.execution;
  const lastTick = systemId === null ? queue.lastTick.self : (queue.lastTick.bySystemId.get(systemId) ?? 0);

  let count = 0;
  for (let i = 0; i < queue.events.length; i++) {
    const entry = queue.events[i]!;
    if (entry.tick > lastTick && entry.tick <= tick) {
      count++;
    }
  }

  return count;
}

/**
 * Fetch only the most recent event, marking all as read.
 *
 * Useful when only the latest state matters (e.g., input, config changes).
 *
 * @param world - World instance
 * @param event - Event definition
 * @returns Most recent event data, or undefined if no unread events
 *
 * @example
 * ```typescript
 * // Only care about the latest input state
 * const input = fetchLastEvent(world, InputChanged);
 * if (input) {
 *   updatePlayerDirection(input.direction);
 * }
 * ```
 */
export function fetchLastEvent<S extends EventSchema>(world: World, event: Event<S>): EventData<S> | undefined {
  const queue = ensureEventQueue(world, event);
  const { systemId, tick } = world.execution;
  const lastTick = systemId === null ? queue.lastTick.self : (queue.lastTick.bySystemId.get(systemId) ?? 0);

  // Find last matching event (iterate backwards, break early)
  let result: EventData<S> | undefined;
  for (let i = queue.events.length - 1; i >= 0; i--) {
    const entry = queue.events[i]!;
    if (entry.tick > lastTick && entry.tick <= tick) {
      result = entry.data;
      break;
    }
  }

  markEventsRead(world, queue);
  cleanupExpiredEvents(world, queue);

  return result;
}

/**
 * Clear events (mark as read without processing).
 *
 * Useful when a system needs to skip events under certain conditions.
 *
 * @param world - World instance
 * @param event - Event definition
 *
 * @example
 * ```typescript
 * if (isPaused) {
 *   // Skip damage events while paused
 *   clearEvents(world, DamageDealt);
 *   return;
 * }
 * ```
 */
export function clearEvents<S extends EventSchema>(world: World, event: Event<S>): void {
  const queue = ensureEventQueue(world, event);
  markEventsRead(world, queue);
  cleanupExpiredEvents(world, queue);
}
