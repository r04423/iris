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
 * World instance.
 *
 * Composes per-domain state; each domain module owns its state type along with
 * the create/reset functions for it.
 */
export type World = {
  /**
   * Entity registry (direct Map-based tracking).
   */
  entities: EntityState;
  /**
   * Name indices maintained by the name system.
   */
  names: NameState;
  /**
   * Component registry
   */
  components: ComponentState;
  /**
   * Archetype registry and transition graph.
   */
  archetypes: ArchetypeState;
  /**
   * Filter registry for query caching.
   */
  filters: FilterState;
  /**
   * Query registry for metadata caching.
   */
  queries: QueryState;
  /**
   * Observer system for lifecycle events.
   */
  observers: ObserverState;
  /**
   * System registry.
   */
  systems: SystemState;
  /**
   * System set registry.
   */
  systemSets: SystemSetState;
  /**
   * Schedule registry and pipeline configuration.
   */
  schedules: ScheduleState;
  /**
   * Current execution state.
   */
  execution: ExecutionState;
  /**
   * Event queue registry.
   */
  events: EventState;
  /**
   * Actions registry for cached world-bound action getters.
   */
  actions: ActionState;
  /**
   * Structural observation revision.
   */
  revision: number;
};

/**
 * Creates a new ECS world with empty entity registry and root archetype.
 *
 * @returns Initialized world instance ready for use
 *
 * @example
 * ```typescript
 * const world = createWorld();
 * const entity = spawnEntity(world);
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
    revision: 1,
  };

  // Filter dispatch must observe before the root archetype registers
  initFilterDispatch(world);
  registerArchetype(world, world.archetypes.root);

  initNameSystem(world);
  initRemovalSystem(world);

  return world;
}

/**
 * Resets world to initial state, clearing all entities and caches.
 *
 * @param world - World instance to reset
 * @throws {IrisSchedulerBusy} If scheduler execution is active
 *
 * @example
 * ```typescript
 * // Stop the world (runs shutdown systems), then reset
 * await stop(world);
 * resetWorld(world);
 * ```
 */
export function resetWorld(world: World): void {
  if (world.execution.running || world.execution.framePromise !== null || world.execution.shutdownPromise !== null) {
    throw new IrisSchedulerBusy("Cannot reset world while scheduler execution is active");
  }

  world.revision = 1;

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
