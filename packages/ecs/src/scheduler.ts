import {
  addEdge,
  addNode,
  createDag,
  type DirectedAcyclicGraph,
  getPredecessors,
  getSuccessors,
  removeNode as removeDagNode,
  topologicalSort,
} from "./directed-acyclic-graph.js";
import {
  assert,
  IrisDuplicate,
  IrisInvalidArgument,
  IrisInvalidState,
  IrisLimitExceeded,
  IrisNotFound,
} from "./error.js";
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
export type SystemReference = SystemRunner | SystemFactory | SystemSetLabel | string;

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

  /**
   * Condition evaluated lazily once for this set per schedule invocation.
   */
  condition?: ConditionFactory;
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

  /**
   * Condition factory attached to this set, if any.
   */
  conditionFactory: ConditionFactory | null;

  /**
   * Initialized condition tick, or null before preparation and after reset.
   */
  conditionRunner: ConditionTick | null;
};

// ============================================================================
// Scheduler Types
// ============================================================================

const CONDITION_FACTORY_BRAND: unique symbol = Symbol("ConditionFactory");
const SYSTEM_FACTORY_BRAND: unique symbol = Symbol("SystemFactory");

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
 * Synchronous condition tick. Returning false skips the attached system or set.
 *
 * Conditions execute outside system observation context. Conditions may observe
 * world state, but must not mutate gameplay data or scheduler registrations.
 *
 * @example
 * ```typescript
 * const enabled = defineCondition("enabled", (world) =>
 *   () => hasResource(world, Enabled)
 * );
 * ```
 */
export type ConditionTick = () => boolean;

/**
 * Reusable condition factory with per-attachment initialization.
 *
 * @example
 * ```typescript
 * const everyOtherRun = defineCondition("everyOtherRun", () => {
 *   let run = false;
 *   return () => (run = !run);
 * });
 * addSystem(world, movementSystem, { condition: everyOtherRun });
 * ```
 */
export type ConditionFactory = {
  /** @internal Runtime brand for condition factories. */
  readonly [CONDITION_FACTORY_BRAND]: true;
  /** Descriptive condition name. */
  readonly name: string;
  /** Initializes a synchronous tick for one attachment. */
  readonly init: (world: World) => ConditionTick;
};

/**
 * System factory with init/tick separation.
 *
 * Created via `defineSystem()`. The init function runs before first execution
 * and after a world reset. The returned tick function runs every frame.
 */
export type SystemFactory = {
  /** @internal Runtime brand for discriminating SystemFactory from SystemRunner. */
  readonly [SYSTEM_FACTORY_BRAND]: true;
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

  /**
   * Condition evaluated before system instrumentation.
   */
  condition?: ConditionFactory;
};

/**
 * Placement of a system in the pipeline.
 *
 * Exactly one of `schedule` or `set` may be provided. When `set` is given,
 * the system inherits the set's schedule. When neither is given, the system
 * defaults to the Update schedule.
 */
type SystemTarget =
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
    };

/**
 * Options for system registration.
 */
export type SystemOptions = SystemOptionsBase & SystemTarget;

/**
 * Options shared by a batch of systems.
 *
 * Names must be unique, so `name` is unavailable here; register such systems
 * individually with `addSystem()`.
 */
export type SystemsOptions = Omit<SystemOptionsBase, "name"> & SystemTarget;

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
   * Condition factory attached to this system, if any.
   */
  conditionFactory: ConditionFactory | null;

  /**
   * Initialized condition tick, or null before preparation and after reset.
   */
  conditionRunner: ConditionTick | null;

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
 * via the `set` option. Its label must be unique among all systems and system
 * sets registered in the world.
 *
 * @param world - World instance
 * @param set - System set label from `defineSystemSet()`
 * @param options - Registration options (schedule, before, after, condition)
 *
 * @example
 * ```typescript
 * const PhysicsSystems = defineSystemSet("PhysicsSystems");
 * const RenderSystems = defineSystemSet("RenderSystems");
 * addSystemSet(world, PhysicsSystems, {
 *   schedule: Update,
 *   before: RenderSystems,
 *   condition: gameIsRunning,
 * });
 * addSystemSet(world, RenderSystems, { schedule: Update });
 * ```
 */
export function addSystemSet(world: World, set: SystemSetLabel, options?: SystemSetOptions): void {
  assert(!world.systemSets.byId.has(set), IrisDuplicate, { resource: "SystemSet", id: set });
  assert(!world.systems.byId.has(set), IrisDuplicate, { resource: "System", id: set });

  world.systemSets.byId.set(set, {
    schedule: options?.schedule ?? Update,
    before: normalizeReferences(options?.before),
    after: normalizeReferences(options?.after),
    systems: [],
    conditionFactory: options?.condition ?? null,
    conditionRunner: null,
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

/**
 * Normalizes an optional single reference or reference array to a name array.
 * @internal
 */
function normalizeReferences(refs: SystemReference | SystemReference[] | undefined): string[] {
  if (!refs) {
    return [];
  }

  return Array.isArray(refs) ? refs.map(resolveReference) : [resolveReference(refs)];
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
 * Its effective name must be unique among all systems and system sets
 * registered in the world.
 *
 * @param world - World instance
 * @param system - System function or factory (must be named unless name option provided)
 * @param options - Registration options (name, schedule, set, before, after, condition)
 *
 * @example
 * ```typescript
 * addSystem(world, physicsSystem);
 * addSystem(world, renderSystem, {
 *   schedule: PostUpdate,
 *   after: physicsSystem,
 *   condition: rendererIsReady,
 * });
 * addSystem(world, movementFactory); // SystemFactory from defineSystem()
 * ```
 */
export function addSystem(world: World, system: SystemRunner | SystemFactory, options?: SystemOptions): void {
  const factory = isSystemFactory(system) ? system : null;
  const runner = factory === null ? (system as SystemRunner) : null;
  const name = options?.name ?? system.name;

  assert(name && name !== "anonymous", IrisInvalidArgument, { expected: "named system function or name option" });
  assert(!world.systems.byId.has(name), IrisDuplicate, { resource: "System", id: name });
  assert(!world.systemSets.byId.has(name as SystemSetLabel), IrisDuplicate, { resource: "SystemSet", id: name });

  const setLabel = options?.set;
  const setMeta = setLabel === undefined ? null : (world.systemSets.byId.get(setLabel) ?? null);

  if (setLabel !== undefined) {
    assert(setMeta !== null, IrisNotFound, {
      resource: "SystemSet",
      id: setLabel,
      context: `"${name}" set option`,
    });
  }

  world.systems.byId.set(name, {
    runner,
    factory,
    conditionFactory: options?.condition ?? null,
    conditionRunner: null,
    // A set's schedule wins over the schedule option, which the types forbid combining.
    schedule: setMeta !== null ? setMeta.schedule : (options?.schedule ?? Update),
    index: world.systems.nextIndex++,
    before: normalizeReferences(options?.before),
    after: normalizeReferences(options?.after),
    set: setLabel,
  });

  setMeta?.systems.push(name);

  world.schedules.dirty = true;
}

/**
 * Registers several systems that share the same options.
 *
 * @param world - World instance
 * @param systems - System functions or factories
 * @param options - Options applied to every entry (schedule, set, before, after, condition)
 *
 * @example
 * ```typescript
 * addSystems(world, [broadphase, narrowphase, solver], { set: PhysicsSystems });
 * ```
 */
export function addSystems(world: World, systems: (SystemRunner | SystemFactory)[], options?: SystemsOptions): void {
  for (let i = 0; i < systems.length; i++) {
    addSystem(world, systems[i]!, options);
  }
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
 *     const entities = collectEntities(world, movers);
 *     for (const entity of entities) {
 *       const x = getComponentValue(world, entity, Position, "x")!;
 *       const vx = getComponentValue(world, entity, Velocity, "vx")!;
 *       setComponentValue(world, entity, Position, "x", x + vx * dt);
 *     }
 *   };
 * });
 *
 * addSystem(world, movementSystem);
 * addSystem(world, movementSystem, { schedule: PostUpdate, name: "lateMovement" });
 * ```
 */
export function defineSystem(name: string, init: (world: World) => SystemTick): SystemFactory {
  return { [SYSTEM_FACTORY_BRAND]: true, name, init };
}

/**
 * Define a reusable synchronous scheduler condition.
 *
 * The initializer runs independently for every system or set attachment before
 * scheduling begins and again after `resetWorld()`. It may observe world state,
 * but must not mutate it.
 *
 * @param name - Descriptive condition name
 * @param init - Initializer returning the boolean condition tick
 * @returns Condition factory for a system or system set
 *
 * @example
 * ```typescript
 * const gameIsRunning = defineCondition("gameIsRunning", (world) =>
 *   () => hasResource(world, GameState)
 * );
 * addSystem(world, movementSystem, { condition: gameIsRunning });
 * ```
 */
export function defineCondition(name: string, init: (world: World) => ConditionTick): ConditionFactory {
  return { [CONDITION_FACTORY_BRAND]: true, name, init };
}

function isSystemFactory(system: SystemRunner | SystemFactory): system is SystemFactory {
  return typeof system === "object" && system !== null && SYSTEM_FACTORY_BRAND in system;
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
  insertScheduleAt(world, schedule, anchor, 0);
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
  insertScheduleAt(world, schedule, anchor, 1);
}

/**
 * Splices a schedule into the pipeline at the anchor's index plus an offset.
 * @internal
 */
function insertScheduleAt(world: World, schedule: ScheduleLabel, anchor: ScheduleLabel, offset: 0 | 1): void {
  const idx = world.schedules.pipeline.indexOf(anchor);

  assert(idx !== -1, IrisNotFound, { resource: "Schedule", id: anchor, context: "pipeline" });
  assert(!world.schedules.pipeline.includes(schedule), IrisDuplicate, { resource: "Schedule", id: schedule });

  world.schedules.pipeline.splice(idx + offset, 0, schedule);
  world.schedules.dirty = true;
}

// ============================================================================
// Schedule Building (Internal)
// ============================================================================

/**
 * Adds the before/after edges for one system or set node, rejecting unknown targets.
 *
 * Works for both node kinds because a set's constraints have the same shape as a
 * system's; set nodes are flattened into their members later.
 */
function addConstraintEdges(
  dag: DirectedAcyclicGraph<string>,
  owner: string,
  meta: { before: string[]; after: string[] },
  scheduleSystems: Map<string, SystemMeta>,
  scheduleSets: Map<string, SystemSetMeta>,
  scheduleLabel: ScheduleLabel
): void {
  for (const target of meta.before) {
    assertConstraintTarget(target, scheduleSystems, scheduleSets, owner, "before", scheduleLabel);
    addEdge(dag, owner, target);
  }

  for (const target of meta.after) {
    assertConstraintTarget(target, scheduleSystems, scheduleSets, owner, "after", scheduleLabel);
    addEdge(dag, target, owner);
  }
}

function assertConstraintTarget(
  target: string,
  scheduleSystems: Map<string, SystemMeta>,
  scheduleSets: Map<string, SystemSetMeta>,
  owner: string,
  kind: "before" | "after",
  scheduleLabel: ScheduleLabel
): void {
  if (!scheduleSystems.has(target) && !scheduleSets.has(target)) {
    throw new IrisNotFound({
      resource: "System or SystemSet",
      id: target,
      context: `"${owner}" ${kind} constraint in schedule "${scheduleLabel}"`,
    });
  }
}

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

  // Add system and set constraint edges
  for (const [name, meta] of scheduleSystems) {
    addConstraintEdges(dag, name, meta, scheduleSystems, scheduleSets, scheduleLabel);
  }

  for (const [label, meta] of scheduleSets) {
    addConstraintEdges(dag, label, meta, scheduleSystems, scheduleSets, scheduleLabel);
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
    throw new IrisInvalidState({
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
  // Every path that leaves a runner or condition uninitialized also marks the
  // schedules dirty, so this one flag gates both init and the rebuild.
  if (!world.schedules.dirty) {
    return;
  }

  // Complete system setup before condition setup so every condition observes
  // a fully initialized system layer.
  for (const meta of world.systems.byId.values()) {
    if (meta.runner === null) {
      meta.runner = meta.factory!.init(world);
    }
  }

  for (const meta of world.systems.byId.values()) {
    if (meta.conditionFactory !== null && meta.conditionRunner === null) {
      meta.conditionRunner = meta.conditionFactory.init(world);
    }
  }

  for (const meta of world.systemSets.byId.values()) {
    if (meta.conditionFactory !== null && meta.conditionRunner === null) {
      meta.conditionRunner = meta.conditionFactory.init(world);
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
    // A set's condition is evaluated at most once per schedule invocation, so its
    // members cannot disagree about whether the set ran.
    let setResults: Map<SystemSetLabel, boolean> | null = null;

    for (const systemId of order) {
      const meta = world.systems.byId.get(systemId)!;
      world.execution.systemId = null;

      if (meta.set !== undefined) {
        const setMeta = world.systemSets.byId.get(meta.set)!;

        if (setMeta.conditionRunner !== null) {
          setResults ??= new Map();
          let passed = setResults.get(meta.set);

          if (passed === undefined) {
            passed = setMeta.conditionRunner();
            setResults.set(meta.set, passed);
          }

          if (!passed) {
            continue;
          }
        }
      }

      if (meta.conditionRunner !== null && !meta.conditionRunner()) {
        continue;
      }

      world.execution.systemId = systemId;
      const systemStart = performance.now();
      fireObserverEvent(world, "systemStarted", systemId, scheduleLabel);

      const result = meta.runner!(world);

      // Await async systems, sync systems pass through unchanged
      if (result instanceof Promise) {
        await result;
      }

      fireObserverEvent(world, "systemFinished", systemId, scheduleLabel, performance.now() - systemStart);
    }
  } finally {
    world.execution.scheduleLabel = null;
    world.execution.systemId = null;

    fireObserverEvent(world, "scheduleFinished", scheduleLabel, performance.now() - scheduleStart);
  }
}

// ============================================================================
// Public Execution API
// ============================================================================

/** Execute one frame. */
async function executeFrame(world: World): Promise<void> {
  try {
    assert(world.execution.tick < Number.MAX_SAFE_INTEGER, IrisLimitExceeded, {
      resource: "World frame tick",
      max: Number.MAX_SAFE_INTEGER,
    });

    world.execution.tick++;

    prepareSystems(world);

    // Run startup schedule on first call
    if (!world.execution.startupRan) {
      await executeSchedule(world, Startup);
      world.execution.startupRan = true;
    }

    // Run all pipeline schedules in order
    for (let i = 0; i < world.schedules.pipeline.length; i++) {
      await executeSchedule(world, world.schedules.pipeline[i]!);
    }

    // Flush events at end of frame
    flushEvents(world);
  } catch (error) {
    world.execution.running = false;

    throw error;
  } finally {
    world.execution.framePromise = null;
  }

  if (world.execution.running) {
    scheduleFrame(world);
  }
}

/**
 * Admit and start a frame. Rejects while another frame or Shutdown is active.
 */
function startFrame(world: World): Promise<void> {
  assert(world.execution.framePromise === null, IrisInvalidState, { message: "A frame is already executing" });
  assert(world.execution.shutdownPromise === null, IrisInvalidState, { message: "Shutdown is executing" });

  world.execution.shutdownRan = false;

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  world.execution.framePromise = promise;
  executeFrame(world).then(resolve, reject);

  return promise;
}

/**
 * Execute one frame. Runs startup on first call, then all pipeline schedules,
 * then flushes events. Rejects if another frame, the animation frame loop,
 * or Shutdown is active.
 *
 * @param world - World instance
 * @returns Promise that resolves when the frame completes
 *
 * @example
 * ```typescript
 * await runOnce(world);
 * ```
 */
export async function runOnce(world: World): Promise<void> {
  assert(!world.execution.running, IrisInvalidState, { message: "The animation frame loop is running" });

  await startFrame(world);
}

/**
 * Start or resume the main loop using requestAnimationFrame.
 *
 * Startup schedule runs automatically on first frame. Each frame executes
 * all pipeline schedules in order. Call `suspend()` to halt the loop without
 * running Shutdown, or `stop()` to end the lifecycle. Ignored while a
 * shutdown is in progress.
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
  if (world.execution.running || world.execution.shutdownPromise !== null) {
    return;
  }

  world.execution.running = true;

  if (world.execution.framePromise === null) {
    scheduleFrame(world);
  }
}

/**
 * Suspend the requestAnimationFrame loop without running Shutdown.
 * An active frame finishes before the returned promise resolves. Call `run()`
 * to resume without running Startup again.
 *
 * @param world - World instance
 * @returns Active frame promise, or a resolved promise if no frame is active
 *
 * @example
 * ```typescript
 * await suspend(world);
 * run(world);
 * ```
 */
export function suspend(world: World): Promise<void> {
  world.execution.running = false;

  if (world.execution.rafHandle !== null) {
    cancelAnimationFrame(world.execution.rafHandle);
    world.execution.rafHandle = null;
  }

  return world.execution.framePromise ?? Promise.resolve();
}

/**
 * Schedules the next animation frame for the game loop.
 */
function scheduleFrame(world: World): void {
  world.execution.rafHandle = requestAnimationFrame(async () => {
    world.execution.rafHandle = null;

    if (!world.execution.running) {
      return;
    }

    await startFrame(world);
  });
}

/**
 * Wait for the active frame and execute the shutdown schedule.
 */
async function runShutdown(world: World): Promise<void> {
  // Shutdown runs even if the frame threw, so its failure is settled, not awaited.
  const [frame] = await Promise.allSettled([world.execution.framePromise]);

  try {
    prepareSystems(world);
    await executeSchedule(world, Shutdown);
  } catch (shutdownError) {
    // A failed shutdown leaves shutdownPromise set, so stop() keeps reporting it.
    throw frame.status === "rejected"
      ? new AggregateError([frame.reason, shutdownError], "Frame and shutdown both failed")
      : shutdownError;
  }

  world.execution.shutdownRan = true;
  world.execution.startupRan = false;
  world.execution.shutdownPromise = null;

  if (frame.status === "rejected") {
    throw frame.reason;
  }
}

/**
 * Stop the main loop, wait for the active frame, and run the shutdown schedule.
 * Concurrent calls wait for the same shutdown.
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
export function stop(world: World): Promise<void> {
  suspend(world);

  if (world.execution.shutdownPromise !== null) {
    return world.execution.shutdownPromise;
  }

  if (world.execution.shutdownRan) {
    return Promise.resolve();
  }

  const shutdown = runShutdown(world);

  world.execution.shutdownPromise = shutdown;

  return shutdown;
}
