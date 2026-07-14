import {
  addEdge,
  addNode,
  createDag,
  getPredecessors,
  getSuccessors,
  removeNode as removeDagNode,
  topologicalSort,
} from "./directed-acyclic-graph.js";
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
// System Set Label Types
// ============================================================================

/**
 * System set label brand for nominal typing.
 */
declare const SYSTEM_SET_LABEL_BRAND: unique symbol;

/**
 * System set label (branded string).
 *
 * Identifies a system set for group-level ordering.
 */
export type SystemSetLabel = string & { [SYSTEM_SET_LABEL_BRAND]: true };

/**
 * Reference to a system or system set in ordering constraints.
 */
export type SystemReference = SystemFactory | SystemSetLabel | string;

/**
 * Options for system set registration.
 */
export type SystemSetOptions = {
  /**
   * Schedule this set belongs to. Defaults to Update.
   */
  schedule?: ScheduleLabel;

  /**
   * All systems in this set run before these systems or sets.
   */
  before?: SystemReference | SystemReference[];

  /**
   * All systems in this set run after these systems or sets.
   */
  after?: SystemReference | SystemReference[];
};

/**
 * System set metadata stored in registry.
 */
export type SystemSetMeta = {
  /**
   * Schedule this set belongs to.
   */
  schedule: ScheduleLabel;

  /**
   * Systems or sets this set must execute before.
   */
  before: string[];

  /**
   * Systems or sets this set must execute after.
   */
  after: string[];

  /**
   * System names that belong to this set (populated by addSystem calls).
   */
  systems: string[];
};

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
 * Created via `defineSystem()`. The init function runs before first execution
 * and after a world reset. The returned tick function runs every frame.
 */
export type SystemFactory = {
  /** @internal Runtime brand for discriminating SystemFactory from SystemRunner. */
  readonly __systemFactory: true;
  /** System name for scheduling constraints and execution context. */
  readonly name: string;
  /**
   * Init function. Runs before first execution and again after `resetWorld()`.
   * It receives the world, returns a tick function, and must be safe to repeat.
   */
  readonly init: (world: World) => SystemTick;
};

/**
 * Shared options for system registration.
 */
type SystemOptionsBase = {
  /**
   * Custom name (overrides function.name). Required for anonymous functions.
   */
  name?: string;

  /**
   * Run before these systems or sets (within same schedule).
   */
  before?: SystemReference | SystemReference[];

  /**
   * Run after these systems or sets (within same schedule).
   */
  after?: SystemReference | SystemReference[];
};

/**
 * Options for system registration.
 *
 * Exactly one of `schedule` or `set` may be provided. When `set` is given,
 * the system inherits the set's schedule. When neither is given, the system
 * defaults to the Update schedule.
 */
export type SystemOptions = SystemOptionsBase &
  (
    | {
        /** Schedule this system belongs to. Defaults to Update. */
        schedule?: ScheduleLabel;
        set?: never;
      }
    | {
        schedule?: never;
        /**
         * System set this system belongs to. The set must be registered first
         * via `addSystemSet()`. The set's schedule applies to this system.
         */
        set?: SystemSetLabel;
      }
  );

/**
 * System metadata stored in registry.
 */
export type SystemMeta = {
  /**
   * Function to execute, or null while a factory awaits initialization.
   */
  runner: SystemRunner | null;

  /**
   * Factory used to create the runner before execution and after a world reset.
   */
  factory: SystemFactory | null;

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

  /**
   * System set this system belongs to, if any.
   */
  set?: SystemSetLabel;
};

// ============================================================================
// System Set Definition
// ============================================================================

/**
 * Define a system set label.
 *
 * System sets are named groups for group-level ordering. Define the label
 * first, then register it in a world via `addSystemSet()`.
 *
 * @param name - Set name (must be unique when registered)
 * @returns System set label
 *
 * @example
 * ```typescript
 * const PhysicsSystems = defineSystemSet("PhysicsSystems");
 * addSystemSet(world, PhysicsSystems, { before: RenderSystems });
 * ```
 */
export function defineSystemSet(name: string): SystemSetLabel {
  return name as SystemSetLabel;
}

// ============================================================================
// System Set Registration
// ============================================================================

/**
 * Register a system set in the world with optional ordering constraints.
 *
 * Must be called before any `addSystem()` call that references this set
 * via the `set` option.
 *
 * @param world - World instance
 * @param set - System set label from `defineSystemSet()`
 * @param options - Registration options (schedule, before, after)
 *
 * @example
 * ```typescript
 * const PhysicsSystems = defineSystemSet("PhysicsSystems");
 * const RenderSystems = defineSystemSet("RenderSystems");
 * addSystemSet(world, PhysicsSystems, { schedule: Update, before: RenderSystems });
 * addSystemSet(world, RenderSystems, { schedule: Update });
 * ```
 */
export function addSystemSet(world: World, set: SystemSetLabel, options?: SystemSetOptions): void {
  assert(!world.systemSets.byId.has(set), Duplicate, { resource: "SystemSet", id: set });

  const before = options?.before;
  const after = options?.after;

  world.systemSets.byId.set(set, {
    schedule: options?.schedule ?? Update,
    before: !before ? [] : Array.isArray(before) ? before.map(resolveReference) : [resolveReference(before)],
    after: !after ? [] : Array.isArray(after) ? after.map(resolveReference) : [resolveReference(after)],
    systems: [],
  });

  world.schedules.dirty = true;
}

// ============================================================================
// Reference Resolution
// ============================================================================

/**
 * Resolves a SystemReference to a string name.
 * @internal
 */
function resolveReference(ref: SystemReference): string {
  return typeof ref === "string" ? ref : ref.name;
}

// ============================================================================
// System Registration
// ============================================================================

/**
 * Registers a system in the world for later scheduling.
 *
 * Accepts either a `SystemRunner` function or a `SystemFactory` created by
 * `defineSystem()`. Factory initialization is deferred until the next
 * `runOnce()` or `stop()` call, immediately before schedules execute.
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
  let runner: SystemRunner | null;
  let factory: SystemFactory | null;
  let name: string;

  if (isSystemFactory(system)) {
    runner = null;
    factory = system;
    name = options?.name ?? system.name;
  } else {
    runner = system;
    factory = null;
    name = options?.name ?? system.name;
  }

  assert(name && name !== "anonymous", InvalidArgument, { expected: "named system function or name option" });
  assert(!world.systems.byId.has(name), Duplicate, { resource: "System", id: name });

  const setLabel = options?.set;

  // Validate set exists
  if (setLabel) {
    assert(world.systemSets.byId.has(setLabel), NotFound, {
      resource: "SystemSet",
      id: setLabel,
      context: `"${name}" set option`,
    });
  }

  // Resolve schedule: from set if specified, else from options, else Update
  const schedule = setLabel ? world.systemSets.byId.get(setLabel)!.schedule : (options?.schedule ?? Update);

  // Normalize before/after constraints to arrays
  const before = options?.before;
  const after = options?.after;

  world.systems.byId.set(name, {
    runner,
    factory,
    schedule,
    index: world.systems.nextIndex++,
    before: !before ? [] : Array.isArray(before) ? before.map(resolveReference) : [resolveReference(before)],
    after: !after ? [] : Array.isArray(after) ? after.map(resolveReference) : [resolveReference(after)],
    set: setLabel,
  });

  // Add system to set's member list
  if (setLabel) {
    world.systemSets.byId.get(setLabel)!.systems.push(name);
  }

  world.schedules.dirty = true;
}

// ============================================================================
// System Factory
// ============================================================================

/**
 * Define a system with separate init and tick phases.
 *
 * The init function runs before the system's first execution and again after
 * `resetWorld()`. Initialization is deferred from `addSystem()` until the next
 * `runOnce()` or `stop()` and must be safe to repeat. Use it to cache query
 * references, action getters, and other setup tied to the current world state.
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
 *   // Init: runs before the first execution and after each reset
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
 * Builds an execution order from registered systems using a DAG with set flattening.
 *
 * 1. Collect systems and sets for this schedule
 * 2. Build DAG with system + set nodes and constraint edges
 * 3. Flatten: replace set nodes with edges to/from member systems
 * 4. Topological sort with registration-index comparator
 */
function buildSchedule(world: World, scheduleLabel: ScheduleLabel): void {
  // Collect systems belonging to this schedule
  const scheduleSystems = new Map<string, SystemMeta>();

  for (const [name, meta] of world.systems.byId) {
    if (meta.schedule === scheduleLabel) {
      scheduleSystems.set(name, meta);
    }
  }

  // Collect sets belonging to this schedule
  const scheduleSets = new Map<string, SystemSetMeta>();

  for (const [label, meta] of world.systemSets.byId) {
    if (meta.schedule === scheduleLabel) {
      scheduleSets.set(label, meta);
    }
  }

  if (scheduleSystems.size === 0) {
    world.schedules.byId.set(scheduleLabel, []);
    return;
  }

  // Build DAG with system and set nodes
  const dag = createDag<string>();

  for (const name of scheduleSystems.keys()) {
    addNode(dag, name);
  }

  for (const label of scheduleSets.keys()) {
    addNode(dag, label);
  }

  // Add system constraint edges
  for (const [name, meta] of scheduleSystems) {
    for (const beforeName of meta.before) {
      if (!scheduleSystems.has(beforeName) && !scheduleSets.has(beforeName)) {
        throw new NotFound({
          resource: "System or SystemSet",
          id: beforeName,
          context: `"${name}" before constraint in schedule "${scheduleLabel}"`,
        });
      }
      addEdge(dag, name, beforeName);
    }

    for (const afterName of meta.after) {
      if (!scheduleSystems.has(afterName) && !scheduleSets.has(afterName)) {
        throw new NotFound({
          resource: "System or SystemSet",
          id: afterName,
          context: `"${name}" after constraint in schedule "${scheduleLabel}"`,
        });
      }
      addEdge(dag, afterName, name);
    }
  }

  // Add set constraint edges
  for (const [label, meta] of scheduleSets) {
    for (const beforeName of meta.before) {
      if (!scheduleSystems.has(beforeName) && !scheduleSets.has(beforeName)) {
        throw new NotFound({
          resource: "System or SystemSet",
          id: beforeName,
          context: `"${label}" before constraint in schedule "${scheduleLabel}"`,
        });
      }
      addEdge(dag, label, beforeName);
    }

    for (const afterName of meta.after) {
      if (!scheduleSystems.has(afterName) && !scheduleSets.has(afterName)) {
        throw new NotFound({
          resource: "System or SystemSet",
          id: afterName,
          context: `"${label}" after constraint in schedule "${scheduleLabel}"`,
        });
      }
      addEdge(dag, afterName, label);
    }
  }

  // Flatten: replace set nodes with edges to/from member systems
  for (const [label, meta] of scheduleSets) {
    const predecessors = getPredecessors(dag, label);
    const successors = getSuccessors(dag, label);

    if (meta.systems.length === 0) {
      // Empty set: wire predecessors directly to successors
      for (const pred of predecessors) {
        for (const succ of successors) {
          addEdge(dag, pred, succ);
        }
      }
    } else {
      // Redirect edges to/from each member system
      for (const pred of predecessors) {
        for (let k = 0; k < meta.systems.length; k++) {
          addEdge(dag, pred, meta.systems[k]!);
        }
      }
      for (const succ of successors) {
        for (let k = 0; k < meta.systems.length; k++) {
          addEdge(dag, meta.systems[k]!, succ);
        }
      }
    }

    removeDagNode(dag, label);
  }

  // Sort with registration-index comparator for determinism
  let result: string[];

  try {
    result = topologicalSort(dag, (a, b) => {
      return scheduleSystems.get(a)!.index - scheduleSystems.get(b)!.index;
    });
  } catch (err) {
    throw new InvalidState({
      message: `Circular dependency in schedule "${scheduleLabel}": ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  world.schedules.byId.set(scheduleLabel, result);
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

/**
 * Initializes pending factory systems, then rebuilds dirty schedules.
 * @internal
 */
function prepareSystems(world: World): void {
  if (!world.schedules.dirty) {
    return;
  }

  for (const meta of world.systems.byId.values()) {
    if (meta.runner === null) {
      meta.runner = meta.factory!.init(world);
    }
  }

  rebuildPipeline(world);
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
      const result = meta.runner!(world);

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
  prepareSystems(world);

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

  prepareSystems(world);

  if (!world.execution.shutdownRan) {
    await executeSchedule(world, Shutdown);
    world.execution.shutdownRan = true;
    world.execution.startupRan = false;
  }
}
