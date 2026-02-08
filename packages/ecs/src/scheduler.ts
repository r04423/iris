import { flushEvents } from "./event.js";
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
  before?: string | string[];

  /**
   * Run after these systems (within same schedule).
   */
  after?: string | string[];
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
 * @param world - World instance
 * @param runner - System function (must be named unless name option provided)
 * @param options - Registration options (name, schedule, before, after)
 *
 * @example
 * ```typescript
 * addSystem(world, physicsSystem);
 * addSystem(world, renderSystem, { schedule: PostUpdate, after: "physicsSystem" });
 * ```
 */
export function addSystem(world: World, runner: SystemRunner, options?: SystemOptions): void {
  // Derive system name from function name or explicit option
  const name = options?.name ?? runner.name;

  if (!name || name === "anonymous") {
    throw new TypeError("System function must be named or provide name option");
  }

  if (world.systems.byId.has(name)) {
    throw new Error(`System "${name}" already registered`);
  }

  // Normalize before/after constraints to arrays for consistent handling
  const before = options?.before;
  const after = options?.after;

  world.systems.byId.set(name, {
    runner,
    schedule: options?.schedule ?? Update,
    index: world.systems.nextIndex++,
    before: !before ? [] : Array.isArray(before) ? before : [before],
    after: !after ? [] : Array.isArray(after) ? after : [after],
  });

  world.schedules.dirty = true;
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

  if (idx === -1) {
    throw new Error(`Schedule "${anchor}" not found in pipeline`);
  }

  if (world.schedules.pipeline.includes(schedule)) {
    throw new Error(`Schedule "${schedule}" already in pipeline`);
  }

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

  if (idx === -1) {
    throw new Error(`Schedule "${anchor}" not found in pipeline`);
  }

  if (world.schedules.pipeline.includes(schedule)) {
    throw new Error(`Schedule "${schedule}" already in pipeline`);
  }

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
        throw new Error(`System "${name}" references unknown system "${beforeName}" in schedule "${scheduleLabel}"`);
      }

      // "A before B" means edge A -> B (A must run first)
      adjacency.get(name)!.push(beforeName);
      inDegree.set(beforeName, inDegree.get(beforeName)! + 1);
    }

    for (const afterName of meta.after) {
      if (!scheduleSystems.has(afterName)) {
        throw new Error(`System "${name}" references unknown system "${afterName}" in schedule "${scheduleLabel}"`);
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

    throw new Error(`Circular dependency in schedule "${scheduleLabel}": ${remaining.join(", ")}`);
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

  try {
    for (const systemId of order) {
      world.execution.tick++;
      world.execution.systemId = systemId;
      const meta = world.systems.byId.get(systemId)!;
      const result = meta.runner(world);

      // Await async systems, sync systems pass through unchanged
      if (result instanceof Promise) {
        await result;
      }
    }
  } finally {
    world.execution.tick++;
    world.execution.scheduleLabel = null;
    world.execution.systemId = null;
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
