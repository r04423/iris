import type { World } from "./world.js";

// ============================================================================
// Scheduler Types
// ============================================================================

/**
 * Schedule identifier.
 *
 * Provides autocomplete for common schedules while allowing custom names.
 */
export type ScheduleId = "runtime" | "startup" | "shutdown" | (string & {});

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
   * Schedule this system belongs to. Defaults to 'runtime'.
   */
  schedule?: ScheduleId;

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
  schedule: ScheduleId;

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

/**
 * Registers a system in the world for later scheduling.
 *
 * @param world - World instance
 * @param runner - System function (must be named unless name option provided)
 * @param options - Registration options (name, schedule, before, after)
 * @returns void
 * @example
 * addSystem(world, physicsSystem);
 * addSystem(world, renderSystem, { after: "physicsSystem" });
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
    schedule: options?.schedule ?? "runtime",
    index: world.systems.nextIndex++,
    before: !before ? [] : Array.isArray(before) ? before : [before],
    after: !after ? [] : Array.isArray(after) ? after : [after],
  });
}

/**
 * Builds an execution order from registered systems using topological sort.
 * Systems are ordered by before/after constraints, with registration order as tiebreaker.
 *
 * @param world - World instance
 * @param scheduleId - Schedule identifier (defaults to "runtime")
 * @returns void
 * @example
 * buildSchedule(world);
 * buildSchedule(world, "startup");
 */
export function buildSchedule(world: World, scheduleId: ScheduleId = "runtime"): void {
  // Filter systems belonging to this schedule
  const scheduleSystems = new Map<string, SystemMeta>();

  for (const [name, meta] of world.systems.byId) {
    if (meta.schedule === scheduleId) {
      scheduleSystems.set(name, meta);
    }
  }

  if (scheduleSystems.size === 0) {
    world.schedules.byId.set(scheduleId, []);

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
        throw new Error(`System "${name}" references unknown system "${beforeName}" in schedule "${scheduleId}"`);
      }

      // "A before B" means edge A -> B (A must run first)
      adjacency.get(name)!.push(beforeName);
      inDegree.set(beforeName, inDegree.get(beforeName)! + 1);
    }

    for (const afterName of meta.after) {
      if (!scheduleSystems.has(afterName)) {
        throw new Error(`System "${name}" references unknown system "${afterName}" in schedule "${scheduleId}"`);
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

    throw new Error(`Circular dependency in schedule "${scheduleId}": ${remaining.join(", ")}`);
  }

  world.schedules.byId.set(scheduleId, result);
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
 * Executes a schedule synchronously. Throws if any system returns a Promise.
 *
 * @param world - World instance
 * @param scheduleId - Schedule identifier (defaults to "runtime")
 * @returns void
 * @example
 * executeSchedule(world);
 * executeSchedule(world, "startup");
 */
export function executeSchedule(world: World, scheduleId: ScheduleId = "runtime"): void {
  const order = world.schedules.byId.get(scheduleId);

  if (!order) {
    throw new Error(`Schedule "${scheduleId}" not built`);
  }

  // Track execution context for systems that need to know their environment
  world.execution.scheduleId = scheduleId;

  try {
    for (const systemId of order) {
      world.execution.tick++;
      world.execution.systemId = systemId;
      const meta = world.systems.byId.get(systemId)!;
      const result = meta.runner(world);

      // Fail fast if async system detected in sync execution
      if (result instanceof Promise) {
        throw new Error(`System "${systemId}" returned Promise - use runScheduleAsync`);
      }
    }
  } finally {
    world.execution.tick++;
    world.execution.scheduleId = null;
    world.execution.systemId = null;
  }
}

/**
 * Executes a schedule with async support. Awaits systems that return Promises.
 *
 * @param world - World instance
 * @param scheduleId - Schedule identifier (defaults to "runtime")
 * @returns Promise that resolves when all systems complete
 * @example
 * await executeScheduleAsync(world);
 * await executeScheduleAsync(world, "startup");
 */
export async function executeScheduleAsync(world: World, scheduleId: ScheduleId = "runtime"): Promise<void> {
  const order = world.schedules.byId.get(scheduleId);

  if (!order) {
    throw new Error(`Schedule "${scheduleId}" not built`);
  }

  // Track execution context for systems that need to know their environment
  world.execution.scheduleId = scheduleId;

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
    world.execution.scheduleId = null;
    world.execution.systemId = null;
  }
}
