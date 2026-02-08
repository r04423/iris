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
   * Current buffer, new events are written here.
   */
  current: EventEntry<T>[];
  /**
   * Previous buffer, events from before the last flush. Readable but not writable.
   * Cleared on the next flush.
   */
  previous: EventEntry<T>[];
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
      current: [],
      previous: [],
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

  queue.current.push({ data, tick });
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
    // Snapshot lengths so events emitted during iteration are not visible in this pass
    const prevLen = queue.previous.length;
    const currLen = queue.current.length;

    for (let i = 0; i < prevLen; i++) {
      const entry = queue.previous[i]!;
      if (entry.tick > lastTick && entry.tick <= tick) {
        yield entry.data;
      }
    }

    for (let i = 0; i < currLen; i++) {
      const entry = queue.current[i]!;
      if (entry.tick > lastTick && entry.tick <= tick) {
        yield entry.data;
      }
    }
  } finally {
    markEventsRead(world, queue);
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

  for (let i = 0; i < queue.previous.length; i++) {
    const entry = queue.previous[i]!;
    if (entry.tick > lastTick && entry.tick <= tick) {
      return true;
    }
  }

  for (let i = 0; i < queue.current.length; i++) {
    const entry = queue.current[i]!;
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

  for (let i = 0; i < queue.previous.length; i++) {
    const entry = queue.previous[i]!;
    if (entry.tick > lastTick && entry.tick <= tick) {
      count++;
    }
  }

  for (let i = 0; i < queue.current.length; i++) {
    const entry = queue.current[i]!;
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

  let result: EventData<S> | undefined;

  // Search current buffer backwards first, then previous
  for (let i = queue.current.length - 1; i >= 0; i--) {
    const entry = queue.current[i]!;
    if (entry.tick > lastTick && entry.tick <= tick) {
      result = entry.data;
      break;
    }
  }

  if (result === undefined) {
    for (let i = queue.previous.length - 1; i >= 0; i--) {
      const entry = queue.previous[i]!;
      if (entry.tick > lastTick && entry.tick <= tick) {
        result = entry.data;
        break;
      }
    }
  }

  markEventsRead(world, queue);

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
}

/**
 * Flush all event queues in the world.
 *
 * Swaps the active buffer for each queue and clears the new active buffer.
 * Call once per frame, typically after executeSchedule.
 *
 * @param world - World instance
 *
 * @example
 * ```typescript
 * executeSchedule(world);
 * flushEvents(world);
 * ```
 */
export function flushEvents(world: World): void {
  for (const queue of world.events.byId.values()) {
    const temp = queue.current;
    queue.current = queue.previous;
    queue.previous = temp;
    queue.current.length = 0;
  }
}
