import { IrisDuplicateEvent } from "./error.js";
import { consumeRevisionWindow, inRevisionWindow } from "./revision.js";
import type { NonEmptySchema, Schema, SchemaRecord } from "./schema.js";
import { assertNonEmptySchema } from "./schema.js";
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
 * Field schemas for event data.
 *
 * Same shape as a component schema: field names mapped to `Type` definitions.
 */
export type EventSchema = SchemaRecord;

/**
 * Data type carried by an event: undefined for tag events (empty schema),
 * a resolved field record otherwise.
 * @internal
 */
export type EventData<T extends EventSchema> = keyof T extends never
  ? undefined
  : { [K in keyof T]: T[K] extends Schema<infer U> ? U : never };

/**
 * Branded event ID carrying the schema and name for inference.
 * @internal
 */
export type EventId<S extends EventSchema = EventSchema, N extends string = string> = number & {
  [EVENT_BRAND]: true;
  [EVENT_SCHEMA_BRAND]: S;
  [EVENT_NAME_BRAND]: N;
};

/**
 * Event definition created by {@link defineEvent}.
 *
 * Carries the schema for type-safe event data. The name literal `N` keeps
 * events with identical schemas distinct types.
 */
export type Event<S extends EventSchema = EventSchema, N extends string = string> = {
  /** Unique event ID. */
  readonly id: EventId<S, N>;
  /** Event name (user-defined). */
  readonly name: N;
  /** Field schemas for event data (empty for tag events). */
  readonly schema: S;
};

/**
 * Event narrowed by {@link hasEvents} to guarantee unread data in the current
 * system context, making `readLastEvent()` return a non-optional value.
 */
export type PendingEvent<E extends Event> = E & {
  readonly [HAS_EVENTS_BRAND]: (e: E) => void;
};

/**
 * Queued event data stamped with its emission revision for windowed reads.
 * @internal
 */
export type EventEntry<T extends EventSchema = EventSchema> = {
  /** Event data (undefined for tag events). */
  data: EventData<T>;
  /** Revision when the event was emitted. */
  revision: number;
};

/**
 * Per-world double-buffered queue for one event type.
 * @internal
 */
export type EventQueueMeta<T extends EventSchema = EventSchema> = {
  /** Event definition reference. */
  event: Event<T>;
  /** Current buffer, new events are written here. */
  current: EventEntry<T>[];
  /** Previous buffer, events from before the last flush; readable but not writable, cleared on the next flush. */
  previous: EventEntry<T>[];
  /** Per-system consumed observation revisions. */
  lastRevision: Map<string, number>;
  /** Whether the queue is in the world's active list (has a non-empty buffer). */
  active: boolean;
};

// ============================================================================
// Event State
// ============================================================================

/**
 * Event queue registry.
 * @internal
 */
export type EventState = {
  /** Event queue metadata lookup (event ID -> queue metadata). */
  byId: Map<EventId, EventQueueMeta>;
  /** Queues with non-empty buffers, the only ones flushEvents visits. */
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
  /** Event definitions by ID. */
  byId: Map<EventId, Event>;
  /** Globally allocated event names. */
  names: Set<string>;
  /** Next raw ID to allocate. */
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
 * Defines a tag event or a data event with a typed schema.
 *
 * The name must be unique across the whole process: definitions are global and
 * shared by all worlds, so define events once at module scope. Tag events
 * (no schema) take no data argument in {@link emitEvent}; data events require
 * data matching the schema.
 *
 * @param name - Globally unique event name used for type identity and debugging
 * @param options - Data event options; omit for a tag event
 * @throws {IrisDuplicateEvent} If the event name is already defined
 * @throws {IrisInvalidArgument} If the schema is empty
 *
 * @example
 * ```typescript
 * // Tag event (no data)
 * const GameStarted = defineEvent("GameStarted");
 * emitEvent(world, GameStarted); // No data argument
 *
 * // Data event
 * const DamageDealt = defineEvent("DamageDealt", {
 *   schema: {
 *     target: Type.u32(),
 *     amount: Type.f32(),
 *   },
 * });
 * emitEvent(world, DamageDealt, { target: enemy, amount: 25 });
 * ```
 */
export function defineEvent<N extends string>(name: N): Event<Record<never, never>, N>;

export function defineEvent<N extends string, S extends EventSchema>(
  name: N,
  options: { schema: NonEmptySchema<S> }
): Event<S, N>;

export function defineEvent<N extends string, S extends EventSchema>(
  name: N,
  options?: { schema: NonEmptySchema<S> }
): Event<S, N> | Event<Record<never, never>, N> {
  if (options !== undefined) {
    assertNonEmptySchema(options.schema);
  }

  if (EVENT_REGISTRY.names.has(name)) {
    throw new IrisDuplicateEvent(name);
  }

  const id = EVENT_REGISTRY.nextId as EventId<S, N>;
  const schema = options?.schema ?? ({} as S);

  const event: Event<S, N> = {
    id,
    name,
    schema,
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
 * Resolves the world's queue for an event, creating it lazily on first
 * emit or read.
 * @internal
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
 * Emits an event for systems to read via {@link readEvents}.
 *
 * Callable both inside and outside system execution -- events emitted between
 * frames are delivered on the next frame.
 *
 * Each system consumes events independently, and a system that already ran this
 * frame picks the event up next frame. An unread event stays readable for the
 * remainder of the frame it was emitted in plus one full frame; the second
 * end-of-frame flush discards it. Tag events (empty schema) take no data argument.
 *
 * @example
 * ```typescript
 * emitEvent(world, GameStarted);
 * emitEvent(world, DamageDealt, { target: enemy, amount: 25 });
 * ```
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
 * Core event iteration over a resolved queue.
 *
 * Iterates both buffers (previous then current) with revision filtering.
 * Snapshots buffer lengths so events emitted during iteration are not visible.
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
    if (inRevisionWindow(entry.revision, lastRevision, boundary)) {
      if (callback(entry.data) === false) {
        return;
      }
    }
  }

  for (let i = 0; i < currLen; i++) {
    const entry = queue.current[i]!;
    if (inRevisionWindow(entry.revision, lastRevision, boundary)) {
      if (callback(entry.data) === false) {
        return;
      }
    }
  }
}

/**
 * Iterates the unread window without consuming it or advancing revisions.
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
 */
function findLastInWindow<S extends EventSchema>(
  buffer: EventEntry<S>[],
  lastRevision: number,
  boundary: number
): EventEntry<S> | undefined {
  for (let i = buffer.length - 1; i >= 0; i--) {
    const entry = buffer[i]!;

    if (inRevisionWindow(entry.revision, lastRevision, boundary)) {
      return entry;
    }
  }

  return undefined;
}

/**
 * Reads each event unread by the current system, in emission order.
 *
 * Per-system isolated: every system consumes the same events independently.
 * The whole unread window is consumed up front, so events skipped by an early
 * exit or a throwing callback are still marked read. Events emitted during
 * iteration are not visible in the same call; a later read in the same
 * system, or any other system, sees them.
 *
 * Readable only during system execution: outside a system, this does nothing.
 *
 * @param callback - Called for each unread event. Return `false` to stop iteration early
 * @throws {IrisRevisionOverflow} If the world's revision counter is exhausted
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
  const previous = consumeRevisionWindow(world, queue.lastRevision, systemId, boundary);

  iterateEventQueue(queue, previous, boundary, callback);
}

/**
 * Collects all events unread by the current system into an array.
 *
 * Consumes the unread window like {@link readEvents}. Readable only during
 * system execution: outside a system, this returns an empty array.
 *
 * @throws {IrisRevisionOverflow} If the world's revision counter is exhausted
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
 * Checks whether the current system has unread events, without consuming them.
 *
 * Acts as a type guard: a true result narrows the event to `PendingEvent`,
 * making {@link readLastEvent} return a non-optional value. Readable only
 * during system execution: outside a system, this returns false.
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
 * Counts the current system's unread events, without consuming them.
 *
 * Readable only during system execution: outside a system, this returns zero.
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
 * Reads only the most recent unread event, marking all as read.
 *
 * Useful when only the latest state matters (e.g., input, config changes).
 * Narrow with {@link hasEvents} first for a non-optional return type.
 * Readable only during system execution: outside a system, this returns
 * undefined.
 *
 * @returns Most recent event data, or undefined if no unread events
 * @throws {IrisRevisionOverflow} If the world's revision counter is exhausted
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
  const lastRevision = consumeRevisionWindow(world, queue.lastRevision, systemId, boundary);

  // Current buffer holds the newer events, so search it first
  const entry =
    findLastInWindow(queue.current, lastRevision, boundary) ?? findLastInWindow(queue.previous, lastRevision, boundary);

  return entry?.data;
}

/**
 * Marks the current system's unread events as read without processing them.
 *
 * Useful when a system needs to skip events under certain conditions.
 * Readable only during system execution: outside a system, this does nothing.
 *
 * @throws {IrisRevisionOverflow} If the world's revision counter is exhausted
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

  consumeRevisionWindow(world, queue.lastRevision, systemId, boundary);
}

/**
 * Ages every active event queue at the end of a frame: an event's second
 * flush discards it.
 * @internal
 */
export function flushEvents(world: World): void {
  const active = world.events.active;

  // Iterate backward so swap-pop removal only moves already-visited entries
  for (let i = active.length - 1; i >= 0; i--) {
    const queue = active[i]!;

    // Swap buffers: last frame's events become the expiring previous batch
    const temp = queue.current;
    queue.current = queue.previous;
    queue.previous = temp;

    // Clear the recycled current buffer for this frame's emissions
    queue.current.length = 0;

    // Deactivate drained queues via swap-pop; re-emitting re-activates them
    if (queue.previous.length === 0) {
      queue.active = false;
      active[i] = active[active.length - 1]!;
      active.pop();
    }
  }
}
