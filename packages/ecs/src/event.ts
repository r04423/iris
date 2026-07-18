import { assert, LimitExceeded } from "./error.js";
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

/**
 * Event name brand for nominal uniqueness across same-shaped events.
 */
declare const EVENT_NAME_BRAND: unique symbol;

/**
 * Event presence brand for type-safe event narrowing.
 */
declare const HAS_EVENTS_BRAND: unique symbol;

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
export type EventId<S extends EventSchema = EventSchema, N extends string = string> = number & {
  [EVENT_BRAND]: true;
  [EVENT_SCHEMA_BRAND]: S;
  [EVENT_NAME_BRAND]: N;
};

/**
 * Event definition.
 *
 * Global event definition with schema for type-safe event data.
 * The name literal `N` ensures events with identical schemas are distinct types.
 */
export type Event<S extends EventSchema = EventSchema, N extends string = string> = {
  /**
   * Unique event ID.
   */
  readonly id: EventId<S, N>;
  /**
   * Event name (user-defined).
   */
  readonly name: N;
  /**
   * Field schemas for event data (empty for tag events).
   */
  readonly schema: S;
};

/**
 * Event narrowed to guarantee presence of unread data for current system context.
 */
export type PendingEvent<E extends Event> = E & {
  readonly [HAS_EVENTS_BRAND]: (e: E) => void;
};

/**
 * Internal event entry with an observation revision.
 *
 * Stores event data along with the revision at which it was emitted.
 */
export type EventEntry<T extends EventSchema = EventSchema> = {
  /**
   * Event data (undefined for tag events).
   */
  data: EventData<T>;
  /**
   * Revision when the event was emitted.
   */
  revision: number;
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
   * Per-system consumed observation revisions.
   */
  lastRevision: Map<string, number>;
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
export function defineEvent<N extends string, S extends EventSchema = Record<never, never>>(
  name: N,
  schema?: S
): Event<S, N> {
  const id = EVENT_REGISTRY.nextId++ as EventId<S, N>;

  const event: Event<S, N> = {
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
      lastRevision: new Map(),
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
  const revision = world.revision;

  queue.current.push({ data, revision });
}

// ============================================================================
// Event Reading
// ============================================================================

/**
 * Commits one validated event consumption window and returns its previous boundary.
 */
function consumeEventWindow(world: World, queue: EventQueueMeta, systemId: string, boundary: number): number {
  const previous = queue.lastRevision.get(systemId) ?? 0;

  assert(boundary < Number.MAX_SAFE_INTEGER, LimitExceeded, {
    resource: "World revision",
    max: Number.MAX_SAFE_INTEGER,
  });

  queue.lastRevision.set(systemId, boundary);
  world.revision = boundary + 1;

  return previous;
}

/**
 * Core event iteration over a resolved queue.
 *
 * Iterates both buffers (previous then current) with revision filtering.
 * Snapshots buffer lengths so events emitted during iteration are not visible.
 *
 * @internal
 */
function iterateEventQueue<S extends EventSchema>(
  queue: EventQueueMeta<S>,
  lastRevision: number,
  boundary: number,
  callback: (data: EventData<S>) => unknown
): void {
  const prevLen = queue.previous.length;
  const currLen = queue.current.length;

  for (let i = 0; i < prevLen; i++) {
    const entry = queue.previous[i]!;
    if (entry.revision > lastRevision && entry.revision <= boundary) {
      if (callback(entry.data) === false) return;
    }
  }

  for (let i = 0; i < currLen; i++) {
    const entry = queue.current[i]!;
    if (entry.revision > lastRevision && entry.revision <= boundary) {
      if (callback(entry.data) === false) return;
    }
  }
}

/**
 * Read events emitted since last call via callback.
 *
 * Per-system isolated: each system has independent tracking of which events
 * it has consumed. Multiple systems can consume the same events independently.
 *
 * @param world - World instance
 * @param event - Event definition
 * @param callback - Called for each unread event. Return `false` to stop iteration early
 *
 * @example
 * ```typescript
 * readEvents(world, DamageDealt, (event) => {
 *   applyDamage(event.target, event.amount);
 * });
 * ```
 */
export function readEvents<S extends EventSchema>(
  world: World,
  event: Event<S>,
  callback: (data: EventData<S>) => unknown
): void {
  const { systemId } = world.execution;

  // Outside system context: no-op
  if (systemId === null) {
    return;
  }

  const boundary = world.revision;
  const queue = ensureEventQueue(world, event);
  const previous = consumeEventWindow(world, queue, systemId, boundary);

  iterateEventQueue(queue, previous, boundary, callback);
}

/**
 * Collect all unread events into an array.
 *
 * @param world - World instance
 * @param event - Event definition
 * @returns Array of unread event data
 *
 * @example
 * ```typescript
 * const events = collectEvents(world, DamageDealt);
 * for (const event of events) {
 *   applyDamage(event.target, event.amount);
 * }
 * ```
 */
export function collectEvents<S extends EventSchema>(world: World, event: Event<S>): EventData<S>[] {
  const result: EventData<S>[] = [];

  readEvents(world, event, (data) => {
    result.push(data);
  });

  return result;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if there are unread events for current context.
 *
 * Peeks without consuming or advancing revisions; outside systems returns false.
 *
 * @param world - World instance
 * @param event - Event definition
 * @returns True if unread events exist
 *
 * @example
 * ```typescript
 * if (hasEvents(world, DamageDealt)) {
 *   // DamageDealt narrowed to PendingEvent<typeof DamageDealt>
 *   const last = readLastEvent(world, DamageDealt); // non-null
 * }
 * ```
 */
export function hasEvents<S extends EventSchema>(
  world: World,
  event: Event<S>
): event is Event<S> & PendingEvent<Event<S>> {
  const { systemId } = world.execution;

  // Outside system context: always false
  if (systemId === null) {
    return false;
  }

  const queue = ensureEventQueue(world, event);
  const lastRevision = queue.lastRevision.get(systemId) ?? 0;

  let found = false;

  iterateEventQueue(queue, lastRevision, world.revision, () => {
    found = true;
    return false;
  });

  return found;
}

/**
 * Count unread events for current context.
 *
 * Peeks without consuming or advancing revisions; outside systems returns zero.
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
  const { systemId } = world.execution;

  // Outside system context: always 0
  if (systemId === null) {
    return 0;
  }

  const queue = ensureEventQueue(world, event);
  const lastRevision = queue.lastRevision.get(systemId) ?? 0;

  let count = 0;

  iterateEventQueue(queue, lastRevision, world.revision, () => {
    count++;
  });

  return count;
}

/**
 * Read only the most recent event, marking all as read.
 *
 * Useful when only the latest state matters (e.g., input, config changes).
 *
 * @param world - World instance
 * @param event - Event definition
 * @returns Most recent event data (non-null if narrowed), or undefined if no unread events
 *
 * @example
 * ```typescript
 * // Only care about the latest input state
 * const input = readLastEvent(world, InputChanged);
 * if (input) {
 *   updatePlayerDirection(input.direction);
 * }
 * ```
 */
export function readLastEvent<S extends EventSchema>(world: World, event: PendingEvent<Event<S>>): EventData<S>;

export function readLastEvent<S extends EventSchema>(world: World, event: Event<S>): EventData<S> | undefined;

export function readLastEvent<S extends EventSchema>(world: World, event: Event<S>): EventData<S> | undefined {
  const { systemId } = world.execution;

  // Outside system context: always undefined
  if (systemId === null) {
    return undefined;
  }

  const boundary = world.revision;
  const queue = ensureEventQueue(world, event);
  const lastRevision = consumeEventWindow(world, queue, systemId, boundary);

  let result: EventData<S> | undefined;

  // Search current buffer backwards first, then previous
  for (let i = queue.current.length - 1; i >= 0; i--) {
    const entry = queue.current[i]!;
    if (entry.revision > lastRevision && entry.revision <= boundary) {
      result = entry.data;
      break;
    }
  }

  if (result === undefined) {
    for (let i = queue.previous.length - 1; i >= 0; i--) {
      const entry = queue.previous[i]!;
      if (entry.revision > lastRevision && entry.revision <= boundary) {
        result = entry.data;
        break;
      }
    }
  }

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
  const { systemId } = world.execution;

  // Outside system context: no-op
  if (systemId === null) {
    return;
  }

  const boundary = world.revision;
  const queue = ensureEventQueue(world, event);

  consumeEventWindow(world, queue, systemId, boundary);
}

/**
 * Flush all event queues in the world.
 *
 * Swaps the active buffer for each queue and clears the new active buffer.
 * Called internally at the end of each frame by runOnce().
 *
 * @param world - World instance
 * @internal
 */
export function flushEvents(world: World): void {
  for (const queue of world.events.byId.values()) {
    const temp = queue.current;
    queue.current = queue.previous;
    queue.previous = temp;
    queue.current.length = 0;
  }
}
