import { IrisDuplicateEvent, IrisRevisionOverflow } from "./error.js";
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
  /**
   * Whether the queue is in the world's active list (has a non-empty buffer).
   */
  active: boolean;
};

// ============================================================================
// Event State
// ============================================================================

/**
 * Event queue registry.
 */
export type EventState = {
  /**
   * Event queue metadata lookup (event ID -> queue metadata).
   */
  byId: Map<EventId, EventQueueMeta>;

  /**
   * Queues with non-empty buffers, the only ones flushEvents visits.
   */
  active: EventQueueMeta[];
};

/**
 * Creates an empty event queue registry.
 * @internal
 */
export function createEventState(): EventState {
  return {
    byId: new Map(),
    active: [],
  };
}

/**
 * Clears the world's event queues.
 * @internal
 */
export function resetEventState(world: World): void {
  world.events.byId.clear();
  world.events.active.length = 0;
}

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
   * Globally allocated event names.
   */
  names: Set<string>;

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
  names: new Set(),
  nextId: 0,
};

// ============================================================================
// Event Definition
// ============================================================================

/**
 * Define event type.
 *
 * Allocates a unique event name and ID with optional schema for type-safe event data.
 * Tag events (no schema) use void for data type - emit() requires no data argument.
 *
 * @param name - Globally unique event name used for type identity and debugging
 * @param schema - Optional field schema record (omit for tag events)
 * @returns Event definition
 * @throws {IrisDuplicateEvent} If the event name is already defined
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
  if (EVENT_REGISTRY.names.has(name)) {
    throw new IrisDuplicateEvent(name);
  }

  const id = EVENT_REGISTRY.nextId as EventId<S, N>;

  const event: Event<S, N> = {
    id,
    name,
    schema: schema ?? ({} as S),
  };

  EVENT_REGISTRY.byId.set(id, event as Event);
  EVENT_REGISTRY.names.add(name);
  EVENT_REGISTRY.nextId++;

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
      active: false,
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

  if (!queue.active) {
    queue.active = true;
    world.events.active.push(queue);
  }
}

// ============================================================================
// Event Reading
// ============================================================================

/**
 * Revision at which the given system last consumed this queue.
 */
function lastConsumedRevision(queue: EventQueueMeta, systemId: string): number {
  return queue.lastRevision.get(systemId) ?? 0;
}

/**
 * Whether an entry falls inside the (lastRevision, boundary] consumption window.
 */
function inWindow(entry: EventEntry, lastRevision: number, boundary: number): boolean {
  return entry.revision > lastRevision && entry.revision <= boundary;
}

/**
 * Commits one validated event consumption window and returns its previous boundary.
 */
function consumeEventWindow(world: World, queue: EventQueueMeta, systemId: string, boundary: number): number {
  const previous = lastConsumedRevision(queue, systemId);

  if (boundary >= Number.MAX_SAFE_INTEGER) {
    throw new IrisRevisionOverflow();
  }

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
    if (inWindow(entry, lastRevision, boundary)) {
      if (callback(entry.data) === false) {
        return;
      }
    }
  }

  for (let i = 0; i < currLen; i++) {
    const entry = queue.current[i]!;
    if (inWindow(entry, lastRevision, boundary)) {
      if (callback(entry.data) === false) {
        return;
      }
    }
  }
}

/**
 * Iterate the unread window without consuming it or advancing revisions.
 *
 * @internal
 */
function peekEvents<S extends EventSchema>(
  world: World,
  event: Event<S>,
  callback: (data: EventData<S>) => unknown
): void {
  const { systemId } = world.execution;

  // Outside system context: nothing is readable
  if (systemId === null) {
    return;
  }

  const queue = ensureEventQueue(world, event);

  iterateEventQueue(queue, lastConsumedRevision(queue, systemId), world.revision, callback);
}

/**
 * Last entry of a buffer inside the consumption window, scanning backwards.
 *
 * @internal
 */
function findLastInWindow<S extends EventSchema>(
  buffer: EventEntry<S>[],
  lastRevision: number,
  boundary: number
): EventEntry<S> | undefined {
  for (let i = buffer.length - 1; i >= 0; i--) {
    const entry = buffer[i]!;

    if (inWindow(entry, lastRevision, boundary)) {
      return entry;
    }
  }

  return undefined;
}

/**
 * Read events emitted since last call via callback.
 *
 * Per-system isolated: each system has independent tracking of which events
 * it has consumed. Multiple systems can consume the same events independently.
 *
 * Consumes the whole unread window up front; outside systems does nothing.
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
 * Consumes the unread window; outside systems returns an empty array.
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
  let found = false;

  peekEvents(world, event, () => {
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
  let count = 0;

  peekEvents(world, event, () => {
    count++;
  });

  return count;
}

/**
 * Read only the most recent event, marking all as read.
 *
 * Useful when only the latest state matters (e.g., input, config changes).
 * Outside systems returns undefined.
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

  // Current buffer holds the newer events, so search it first
  const entry =
    findLastInWindow(queue.current, lastRevision, boundary) ?? findLastInWindow(queue.previous, lastRevision, boundary);

  return entry?.data;
}

/**
 * Clear events (mark as read without processing).
 *
 * Useful when a system needs to skip events under certain conditions.
 * Outside systems does nothing.
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
 * Flush all active event queues in the world.
 *
 * Swaps the buffers for each active queue and clears the new current buffer.
 * Called internally at the end of each frame by runOnce().
 *
 * @param world - World instance
 * @internal
 */
export function flushEvents(world: World): void {
  const active = world.events.active;

  for (let i = active.length - 1; i >= 0; i--) {
    const queue = active[i]!;
    const temp = queue.current;
    queue.current = queue.previous;
    queue.previous = temp;
    queue.current.length = 0;

    if (queue.previous.length === 0) {
      queue.active = false;
      active[i] = active[active.length - 1]!;
      active.pop();
    }
  }
}
