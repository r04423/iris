import { assert, Duplicate, InvalidArgument, InvalidState, NotFound } from "./error.js";
import { flushEvents } from "./event.js";
import { fireObserverEvent } from "./observer.js";
import type { World } from "./world.js";

// ============================================================================
// Schedule Label Types
// ============================================================================

/**
 * Schedule label brand for nominal typing.
 */
declare const SCHEDULE_LABEL_BRAND: unique symbol;

/**
 * Schedule label (branded string).
 *
 * Identifies a schedule within the pipeline. Built-in labels are provided
 * for common lifecycle stages, custom labels created via defineSchedule().
 */
export type ScheduleLabel = string & { [SCHEDULE_LABEL_BRAND]: true };

// ============================================================================
// Schedule Definition
// ============================================================================

/**
 * Define a custom schedule label.
 *
 * @param name - Schedule name (must be unique when inserted into pipeline)
 * @returns Schedule label
 *
 * @example
 * ```typescript
 * const Physics = defineSchedule("Physics");
 * insertScheduleAfter(world, Physics, PreUpdate);
 * addSystem(world, gravitySystem, { schedule: Physics });
 * ```
 */
export function defineSchedule(name: string): ScheduleLabel {
  return name as ScheduleLabel;
}

// ============================================================================
// Built-in Schedule Labels
// ============================================================================

/**
 * Startup schedule. Runs once before the first frame.
 */
export const Startup = defineSchedule("Startup");

/**
 * Shutdown schedule. Runs once when stop() is called.
 */
export const Shutdown = defineSchedule("Shutdown");

/**
 * First schedule in the main loop. Runs every frame before PreUpdate.
 *
 * @example
 * ```typescript
 * addSystem(world, inputSystem, { schedule: First });
 * ```
 */
export const First = defineSchedule("First");

/**
 * Pre-update schedule. Runs every frame before Update.
 */
export const PreUpdate = defineSchedule("PreUpdate");

/**
 * Update schedule. Default schedule for systems. Runs every frame.
 *
 * @example
 * ```typescript
 * addSystem(world, physicsSystem); // defaults to Update
 * ```
 */
export const Update = defineSchedule("Update");

/**
 * Post-update schedule. Runs every frame after Update.
 */
export const PostUpdate = defineSchedule("PostUpdate");

/**
 * Last schedule in the main loop. Runs every frame after PostUpdate.
 */
export const Last = defineSchedule("Last");

// ============================================================================
// Scheduler Types
// ============================================================================

/**
 * System function signature.
 *
 * Takes world, returns void or Promise for async systems.
 */
export type SystemRunner = (world: World) => void | Promise<void>;

/**
 * System tick function returned by a SystemFactory's init.
 *
 * Runs every frame. The world is captured in the init closure scope,
 * not passed as a parameter.
 */
export type SystemTick = () => void | Promise<void>;

/**
 * System factory with init/tick separation.
 *
 * Created via `defineSystem()`. The init function runs once at registration
 * time (`addSystem`), the returned tick function runs every frame.
 */
export type SystemFactory = {
  /** @internal Runtime brand for discriminating SystemFactory from SystemRunner. */
  readonly __systemFactory: true;
  /** System name for scheduling constraints and execution context. */
  readonly name: string;
  /** Init function. Receives world, returns tick function. */
  readonly init: (world: World) => SystemTick;
};

/**
 * Options for system registration.
 */
export type SystemOptions = {
  /**
   * Custom name (overrides function.name). Required for anonymous functions.
   */
  name?: string;

  /**
   * Schedule this system belongs to. Defaults to Update.
   */
  schedule?: ScheduleLabel;

  /**
   * Run before these systems (within same schedule).
   */
  before?: SystemFactory | SystemFactory[];

  /**
   * Run after these systems (within same schedule).
   */
  after?: SystemFactory | SystemFactory[];
};

/**
 * System metadata stored in registry.
 */
export type SystemMeta = {
  /**
   * Function to execute.
   */
  runner: SystemRunner;

  /**
   * Schedule this system belongs to.
   */
  schedule: ScheduleLabel;

  /**
   * Registration order (for stable sort).
   */
  index: number;

  /**
   * Systems this one must execute before (these run after this system).
   */
  before: string[];

  /**
   * Systems this one must execute after (these run before this system).
   */
  after: string[];
};

// ============================================================================
// System Registration
// ============================================================================

/**
 * Registers a system in the world for later scheduling.
 *
 * Accepts either a `SystemRunner` function or a `SystemFactory` created by
 * `defineSystem()`. When a factory is passed, its init function runs
 * immediately and the returned tick function is registered as the runner.
 *
 * @param world - World instance
 * @param system - System function or factory (must be named unless name option provided)
 * @param options - Registration options (name, schedule, before, after)
 *
 * @example
 * ```typescript
 * addSystem(world, physicsSystem);
 * addSystem(world, renderSystem, { schedule: PostUpdate, after: physicsSystem });
 * addSystem(world, movementFactory); // SystemFactory from defineSystem()
 * ```
 */
export function addSystem(world: World, system: SystemRunner | SystemFactory, options?: SystemOptions): void {
  let runner: SystemRunner;
  let name: string;

  if (isSystemFactory(system)) {
    const tick = system.init(world);
    runner = tick;
    name = options?.name ?? system.name;
  } else {
    runner = system;
    name = options?.name ?? system.name;
  }

  assert(name && name !== "anonymous", InvalidArgument, { expected: "named system function or name option" });
  assert(!world.systems.byId.has(name), Duplicate, { resource: "System", id: name });

  // Normalize before/after constraints to arrays for consistent handling
  const before = options?.before;
  const after = options?.after;

  world.systems.byId.set(name, {
    runner,
    schedule: options?.schedule ?? Update,
    index: world.systems.nextIndex++,
    before: !before ? [] : Array.isArray(before) ? before.map((s) => s.name) : [before.name],
    after: !after ? [] : Array.isArray(after) ? after.map((s) => s.name) : [after.name],
  });

  world.schedules.dirty = true;
}

// ============================================================================
// System Factory
// ============================================================================

/**
 * Define a system with separate init and tick phases.
 *
 * The init function runs once when the system is registered via `addSystem()`.
 * Use it to cache query references, action getters, and other one-time setup.
 * The returned tick function runs every frame during schedule execution.
 *
 * Local state can be declared as variables in the init closure — use it for
 * system-internal bookkeeping (frame counters, cooldowns, cached computations).
 * Use resources for state other systems need to read, components for per-entity state.
 *
 * @param name - System name
 * @param init - Init function that receives the world and returns a tick function
 * @returns SystemFactory to pass to `addSystem()`
 *
 * @example
 * ```typescript
 * const movementSystem = defineSystem("movementSystem", (world) => {
 *   // Init: runs once at addSystem() time
 *   const movers = cacheQuery(world, [Position, Velocity]);
 *
 *   // Tick: runs every frame
 *   return () => {
 *     const dt = getResourceValue(world, Time, "delta") ?? 0;
 *     queryEntities(world, movers, (entity) => {
 *       const x = getComponentValue(world, entity, Position, "x")!;
 *       const vx = getComponentValue(world, entity, Velocity, "vx")!;
 *       setComponentValue(world, entity, Position, "x", x + vx * dt);
 *     });
 *   };
 * });
 *
 * addSystem(world, movementSystem);
 * addSystem(world, movementSystem, { schedule: PostUpdate, name: "lateMovement" });
 * ```
 */
export function defineSystem(name: string, init: (world: World) => SystemTick): SystemFactory {
  return { __systemFactory: true, name, init };
}

function isSystemFactory(system: SystemRunner | SystemFactory): system is SystemFactory {
  return typeof system === "object" && system !== null && "__systemFactory" in system;
}

// ============================================================================
// Pipeline Management
// ============================================================================

/**
 * Insert a schedule before an existing schedule in the pipeline.
 *
 * @param world - World instance
 * @param schedule - New schedule label to insert
 * @param anchor - Existing schedule label to insert before
 *
 * @example
 * ```typescript
 * const Physics = defineSchedule("Physics");
 * insertScheduleBefore(world, Physics, Update);
 * ```
 */
export function insertScheduleBefore(world: World, schedule: ScheduleLabel, anchor: ScheduleLabel): void {
  const idx = world.schedules.pipeline.indexOf(anchor);

  assert(idx !== -1, NotFound, { resource: "Schedule", id: anchor, context: "pipeline" });

  assert(!world.schedules.pipeline.includes(schedule), Duplicate, { resource: "Schedule", id: schedule });

  world.schedules.pipeline.splice(idx, 0, schedule);
  world.schedules.dirty = true;
}

/**
 * Insert a schedule after an existing schedule in the pipeline.
 *
 * @param world - World instance
 * @param schedule - New schedule label to insert
 * @param anchor - Existing schedule label to insert after
 *
 * @example
 * ```typescript
 * const Render = defineSchedule("Render");
 * insertScheduleAfter(world, Render, PostUpdate);
 * ```
 */
export function insertScheduleAfter(world: World, schedule: ScheduleLabel, anchor: ScheduleLabel): void {
  const idx = world.schedules.pipeline.indexOf(anchor);

  assert(idx !== -1, NotFound, { resource: "Schedule", id: anchor, context: "pipeline" });
  assert(!world.schedules.pipeline.includes(schedule), Duplicate, { resource: "Schedule", id: schedule });

  world.schedules.pipeline.splice(idx + 1, 0, schedule);
  world.schedules.dirty = true;
}

// ============================================================================
// Schedule Building (Internal)
// ============================================================================

/**
 * Builds an execution order from registered systems using topological sort.
 * Systems are ordered by before/after constraints, with registration order as tiebreaker.
 */
function buildSchedule(world: World, scheduleLabel: ScheduleLabel): void {
  // Filter systems belonging to this schedule
  const scheduleSystems = new Map<string, SystemMeta>();

  for (const [name, meta] of world.systems.byId) {
    if (meta.schedule === scheduleLabel) {
      scheduleSystems.set(name, meta);
    }
  }

  if (scheduleSystems.size === 0) {
    world.schedules.byId.set(scheduleLabel, []);

    return;
  }

  // Build dependency graph for Kahn's algorithm
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const name of scheduleSystems.keys()) {
    adjacency.set(name, []);
    inDegree.set(name, 0);
  }

  // Convert before/after constraints into directed edges
  for (const [name, meta] of scheduleSystems) {
    for (const beforeName of meta.before) {
      if (!scheduleSystems.has(beforeName)) {
        throw new NotFound({
          resource: "System",
          id: beforeName,
          context: `"${name}" before constraint in schedule "${scheduleLabel}"`,
        });
      }

      // "A before B" means edge A -> B (A must run first)
      adjacency.get(name)!.push(beforeName);
      inDegree.set(beforeName, inDegree.get(beforeName)! + 1);
    }

    for (const afterName of meta.after) {
      if (!scheduleSystems.has(afterName)) {
        throw new NotFound({
          resource: "System",
          id: afterName,
          context: `"${name}" after constraint in schedule "${scheduleLabel}"`,
        });
      }

      // "A after B" means edge B -> A (B must run first)
      adjacency.get(afterName)!.push(name);
      inDegree.set(name, inDegree.get(name)! + 1);
    }
  }

  // Initialize queue with systems having no dependencies
  const queue: string[] = [];

  for (const [name, degree] of inDegree) {
    if (degree === 0) {
      insertSorted(queue, name, scheduleSystems);
    }
  }

  // Process queue, maintaining sorted order by registration index
  const result: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    for (const dependent of adjacency.get(current)!) {
      const newDegree = inDegree.get(dependent)! - 1;
      inDegree.set(dependent, newDegree);

      if (newDegree === 0) {
        insertSorted(queue, dependent, scheduleSystems);
      }
    }
  }

  // Detect circular dependencies (remaining systems with non-zero in-degree)
  if (result.length !== scheduleSystems.size) {
    const remaining: string[] = [];

    for (const [name, degree] of inDegree) {
      if (degree > 0) {
        remaining.push(name);
      }
    }

    throw new InvalidState({ message: `Circular dependency in schedule "${scheduleLabel}": ${remaining.join(", ")}` });
  }

  world.schedules.byId.set(scheduleLabel, result);
}

/**
 * Inserts a system name into the queue maintaining sorted order by registration index.
 * Uses binary search for O(log n) insertion position lookup.
 * This ensures deterministic ordering when multiple systems have no dependency constraints.
 */
function insertSorted(queue: string[], name: string, systems: Map<string, SystemMeta>): void {
  const index = systems.get(name)!.index;
  let low = 0;
  let high = queue.length;

  // Binary search for correct insertion position
  while (low < high) {
    const mid = (low + high) >>> 1;

    if (systems.get(queue[mid]!)!.index < index) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  queue.splice(low, 0, name);
}

/**
 * Rebuilds all schedules in the pipeline plus Startup and Shutdown.
 */
function rebuildPipeline(world: World): void {
  // Build Startup and Shutdown schedules
  buildSchedule(world, Startup);
  buildSchedule(world, Shutdown);

  // Build all pipeline schedules
  for (let i = 0; i < world.schedules.pipeline.length; i++) {
    buildSchedule(world, world.schedules.pipeline[i]!);
  }

  world.schedules.dirty = false;
}

// ============================================================================
// Schedule Execution (Internal)
// ============================================================================

/**
 * Executes a single schedule. Awaits async systems.
 */
async function executeSchedule(world: World, scheduleLabel: ScheduleLabel): Promise<void> {
  const order = world.schedules.byId.get(scheduleLabel);

  if (!order || order.length === 0) {
    return;
  }

  // Track execution context for systems that need to know their environment
  world.execution.scheduleLabel = scheduleLabel;

  const scheduleStart = performance.now();
  fireObserverEvent(world, "scheduleStarted", scheduleLabel);

  try {
    for (const systemId of order) {
      world.execution.tick++;
      world.execution.systemId = systemId;

      const systemStart = performance.now();
      fireObserverEvent(world, "systemStarted", systemId, scheduleLabel);

      const meta = world.systems.byId.get(systemId)!;
      const result = meta.runner(world);

      // Await async systems, sync systems pass through unchanged
      if (result instanceof Promise) {
        await result;
      }

      fireObserverEvent(world, "systemFinished", systemId, scheduleLabel, performance.now() - systemStart);
    }
  } finally {
    world.execution.tick++;
    world.execution.scheduleLabel = null;
    world.execution.systemId = null;

    fireObserverEvent(world, "scheduleFinished", scheduleLabel, performance.now() - scheduleStart);
  }
}

// ============================================================================
// Public Execution API
// ============================================================================

/**
 * Execute one frame. Runs startup on first call, then all pipeline schedules,
 * then flushes events.
 *
 * @param world - World instance
 * @returns Promise that resolves when the frame completes
 *
 * @example
 * ```typescript
 * // Game loop
 * await runOnce(world);
 * ```
 */
export async function runOnce(world: World): Promise<void> {
  // Rebuild all schedules if pipeline is dirty
  if (world.schedules.dirty) {
    rebuildPipeline(world);
  }

  // Run startup schedule on first call
  if (!world.execution.startupRan) {
    await executeSchedule(world, Startup);
    world.execution.startupRan = true;
    world.execution.shutdownRan = false;
  }

  // Run all pipeline schedules in order
  for (let i = 0; i < world.schedules.pipeline.length; i++) {
    await executeSchedule(world, world.schedules.pipeline[i]!);
  }

  // Flush events at end of frame
  flushEvents(world);
}

/**
 * Start the main loop using requestAnimationFrame.
 *
 * Startup schedule runs automatically on first frame. Each frame executes
 * all pipeline schedules in order. Call stop() to end the loop.
 *
 * @param world - World instance
 *
 * @example
 * ```typescript
 * addSystem(world, physicsSystem);
 * addSystem(world, renderSystem, { schedule: PostUpdate });
 * run(world);
 * // ... later
 * await stop(world);
 * ```
 */
export function run(world: World): void {
  if (world.execution.running) {
    return;
  }

  world.execution.running = true;
  scheduleFrame(world);
}

/**
 * Schedules the next animation frame for the game loop.
 */
function scheduleFrame(world: World): void {
  world.execution.rafHandle = requestAnimationFrame(async () => {
    if (!world.execution.running) {
      return;
    }

    try {
      await runOnce(world);
    } catch (error) {
      world.execution.running = false;
      world.execution.rafHandle = null;
      throw error;
    }

    if (world.execution.running) {
      scheduleFrame(world);
    }
  });
}

/**
 * Stop the main loop and run the shutdown schedule.
 *
 * @param world - World instance
 * @returns Promise that resolves when shutdown completes
 *
 * @example
 * ```typescript
 * run(world);
 * // ... later
 * await stop(world);
 * ```
 */
export async function stop(world: World): Promise<void> {
  world.execution.running = false;

  if (world.execution.rafHandle !== null) {
    cancelAnimationFrame(world.execution.rafHandle);
    world.execution.rafHandle = null;
  }

  // Rebuild if needed before shutdown
  if (world.schedules.dirty) {
    rebuildPipeline(world);
  }

  if (!world.execution.shutdownRan) {
    await executeSchedule(world, Shutdown);
    world.execution.shutdownRan = true;
    world.execution.startupRan = false;
  }
}
