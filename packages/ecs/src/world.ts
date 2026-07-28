import type { ActionState } from "./actions.js";
import { createActionState, resetActionState } from "./actions.js";
import type { ArchetypeState } from "./archetype.js";
import { createArchetypeState, registerArchetype, resetArchetypeState } from "./archetype.js";
import type { EntityState } from "./entity.js";
import { createEntityState, resetEntityState } from "./entity.js";
import { IrisSchedulerBusy } from "./error.js";
import type { EventState } from "./event.js";
import { createEventState, resetEventState } from "./event.js";
import type { FilterState } from "./filters.js";
import { createFilterState, initFilterDispatch, resetFilterState } from "./filters.js";
import type { NameState } from "./name.js";
import { createNameState, initNameSystem, resetNameState } from "./name.js";
import type { ObserverState } from "./observer.js";
import { createObserverState, fireObserverEvent } from "./observer.js";
import type { QueryState } from "./query.js";
import { createQueryState, resetQueryState } from "./query.js";
import type { ComponentState } from "./registry.js";
import { createComponentState } from "./registry.js";
import { initRemovalSystem } from "./removal.js";
import { createRevision, resetRevision } from "./revision.js";
import type { ExecutionState, ScheduleState, SystemSetState, SystemState } from "./scheduler.js";
import {
  createExecutionState,
  createScheduleState,
  createSystemSetState,
  createSystemState,
  resetExecutionState,
  resetScheduleState,
  resetSystemSetState,
  resetSystemState,
} from "./scheduler.js";

// ============================================================================
// World Type
// ============================================================================

/**
 * Container for all ECS state: entities, components, archetypes, queries,
 * schedules, events, and resources.
 *
 * Created by {@link createWorld} and passed as the first argument to every API
 * call. Plain data with no methods -- inspectable in a debugger and safe to
 * hold several of for isolated simulations.
 */
export type World = {
  /** Entity registry (direct Map-based tracking). */
  entities: EntityState;
  /** Name indices maintained by the name system. */
  names: NameState;
  /** Component definition registry. */
  components: ComponentState;
  /** Archetype registry and transition graph. */
  archetypes: ArchetypeState;
  /** Filter registry for query caching. */
  filters: FilterState;
  /** Query registry for metadata caching. */
  queries: QueryState;
  /** Observer system for lifecycle events. */
  observers: ObserverState;
  /** System registry. */
  systems: SystemState;
  /** System set registry. */
  systemSets: SystemSetState;
  /** Schedule registry and pipeline configuration. */
  schedules: ScheduleState;
  /** Current execution state. */
  execution: ExecutionState;
  /** Event queue registry. */
  events: EventState;
  /** Actions registry for cached world-bound action getters. */
  actions: ActionState;
  /** Logical clock for change detection and event delivery. */
  revision: number;
};

// ============================================================================
// World Lifecycle
// ============================================================================

/**
 * Creates an empty world.
 *
 * The entry point of every Iris program: define components once, create a
 * world, then populate it with entities and systems.
 *
 * @example
 * ```typescript
 * const world = createWorld();
 * const player = createEntity(world);
 * addComponent(world, player, Position, { x: 0, y: 0 });
 * ```
 */
export function createWorld(): World {
  const world: World = {
    entities: createEntityState(),
    names: createNameState(),
    components: createComponentState(),
    archetypes: createArchetypeState(),
    filters: createFilterState(),
    queries: createQueryState(),
    observers: createObserverState(),
    systems: createSystemState(),
    systemSets: createSystemSetState(),
    schedules: createScheduleState(),
    execution: createExecutionState(),
    events: createEventState(),
    actions: createActionState(),
    revision: createRevision(),
  };

  // Filter dispatch must observe before the root archetype registers
  initFilterDispatch(world);
  registerArchetype(world, world.archetypes.root);

  initNameSystem(world);
  initRemovalSystem(world);

  return world;
}

/**
 * Resets the world to a fresh state: destroys all entities and clears event
 * queues, name indices, and query caches.
 *
 * Registrations survive -- component, tag, and relation definitions, systems,
 * system sets, and the schedule pipeline all remain, so nothing needs
 * re-registering. System factories re-initialize on the next run.
 *
 * Fires the `worldReset` observer event when done.
 *
 * @throws {IrisSchedulerBusy} If a frame or shutdown is in progress
 *
 * @example
 * ```typescript
 * await stop(world); // Runs shutdown systems first
 * resetWorld(world);
 * ```
 */
export function resetWorld(world: World): void {
  if (world.execution.running || world.execution.framePromise !== null || world.execution.shutdownPromise !== null) {
    throw new IrisSchedulerBusy("Cannot reset world while scheduler execution is active");
  }

  resetRevision(world);
  resetFilterState(world);
  resetQueryState(world);
  resetArchetypeState(world);
  resetEntityState(world);
  resetNameState(world);
  resetExecutionState(world);
  resetSystemState(world);
  resetSystemSetState(world);
  resetScheduleState(world);
  resetEventState(world);
  resetActionState(world);

  registerArchetype(world, world.archetypes.root);

  fireObserverEvent(world, "worldReset", world);
}
