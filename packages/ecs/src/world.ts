import type { ActionInitializer, Actions } from "./actions.js";
import type { Archetype } from "./archetype.js";
import { createArchetype, registerArchetype } from "./archetype.js";
import type { Component, EntityId, Relation, Tag } from "./encoding.js";
import type { EntityMeta } from "./entity.js";
import type { EventId, EventQueueMeta } from "./event.js";
import type { FilterMeta } from "./filters.js";
import { initNameSystem } from "./name.js";
import type { EventType, ObserverMeta } from "./observer.js";
import { fireObserverEvent, unregisterObserverCallback } from "./observer.js";
import type { QueryMeta } from "./query.js";
import type { ComponentMeta } from "./registry.js";
import { COMPONENT_REGISTRY } from "./registry.js";
import { initRemovalSystem } from "./removal.js";
import type { ScheduleLabel, SystemMeta } from "./scheduler.js";
import { First, Last, PostUpdate, PreUpdate, Update } from "./scheduler.js";

// ============================================================================
// World Type
// ============================================================================

/**
 * World instance.
 *
 * Contains entity registry, archetype index, filter registry, query registry,
 * observer system, system registry, schedule registry, and execution state.
 */
export type World = {
  /**
   * Entity registry (direct Map-based tracking).
   */
  entities: {
    /**
     * Entity metadata lookup (entity ID -> metadata).
     */
    byId: Map<EntityId, EntityMeta>;

    /**
     * Freelist of dead entity raw IDs for recycling.
     */
    freeIds: number[];

    /**
     * Next raw ID to allocate.
     */
    nextId: number;

    /**
     * Generation lookup for pair target reconstruction (rawId -> generation).
     */
    generations: Map<number, number>;
  };

  /**
   * Component registry
   */
  components: {
    /**
     * Component metadata lookup (component ID -> metadata).
     */
    byId: Map<Tag | Component | Relation, ComponentMeta>;
  };

  /**
   * Archetype registry and transition graph.
   */
  archetypes: {
    /**
     * Root archetype (empty - no components).
     */
    root: Archetype;

    /**
     * Archetype lookup by hash key (hash -> archetype).
     */
    byId: Map<string, Archetype>;
  };

  /**
   * Filter registry for query caching.
   */
  filters: {
    /**
     * Filter metadata lookup (filter hash -> metadata).
     */
    byId: Map<string, FilterMeta>;
  };

  /**
   * Query registry for metadata caching.
   */
  queries: {
    /**
     * Query metadata lookup (query hash -> metadata).
     */
    byId: Map<string, QueryMeta>;
  };

  /**
   * Observer system for lifecycle events.
   */
  observers: {
    [K in EventType]: ObserverMeta<K>;
  };

  /**
   * System registry.
   */
  systems: {
    /**
     * System metadata by name.
     */
    byId: Map<string, SystemMeta>;

    /**
     * Next registration index for stable ordering.
     */
    nextIndex: number;
  };

  /**
   * Schedule registry and pipeline configuration.
   */
  schedules: {
    /**
     * Built schedules (schedule label -> sorted system IDs).
     */
    byId: Map<ScheduleLabel, string[]>;

    /**
     * Pipeline: ordered list of schedule labels for the main loop.
     */
    pipeline: ScheduleLabel[];

    /**
     * Whether pipeline needs rebuilding.
     */
    dirty: boolean;
  };

  /**
   * Current execution state.
   */
  execution: {
    /**
     * Active schedule label (null if not executing).
     */
    scheduleLabel: ScheduleLabel | null;

    /**
     * Currently executing system ID (null if not executing).
     */
    systemId: string | null;

    /**
     * Execution tick counter.
     */
    tick: number;

    /**
     * Whether the RAF loop is currently active.
     */
    running: boolean;

    /**
     * requestAnimationFrame handle for cancellation.
     */
    rafHandle: number | null;

    /**
     * Whether startup schedule has been executed.
     */
    startupRan: boolean;

    /**
     * Whether shutdown schedule has been executed.
     */
    shutdownRan: boolean;
  };

  /**
   * Event queue registry.
   */
  events: {
    /**
     * Event queue metadata lookup (event ID -> queue metadata).
     */
    byId: Map<EventId, EventQueueMeta>;
  };

  /**
   * Actions registry for cached world-bound action getters.
   */
  actions: {
    /**
     * Actions lookup by initializer function.
     */
    byInitializer: Map<ActionInitializer<Actions>, Actions>;
  };
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
  const root = createArchetype([], new Map());

  const world: World = {
    entities: {
      byId: new Map(),
      freeIds: [],
      nextId: 1,
      generations: new Map(),
    },
    components: {
      byId: COMPONENT_REGISTRY.byId,
    },
    archetypes: {
      root,
      byId: new Map(),
    },
    filters: {
      byId: new Map(),
    },
    queries: {
      byId: new Map(),
    },
    systems: {
      byId: new Map(),
      nextIndex: 0,
    },
    schedules: {
      byId: new Map(),
      pipeline: [First, PreUpdate, Update, PostUpdate, Last],
      dirty: true,
    },
    execution: {
      scheduleLabel: null,
      systemId: null,
      tick: 1,
      running: false,
      rafHandle: null,
      startupRan: false,
      shutdownRan: false,
    },
    events: {
      byId: new Map(),
    },
    actions: {
      byInitializer: new Map(),
    },
    observers: {
      archetypeCreated: { callbacks: [] },
      archetypeDestroyed: { callbacks: [] },
      filterCreated: { callbacks: [] },
      filterDestroyed: { callbacks: [] },
      entityCreated: { callbacks: [] },
      entityDestroyed: { callbacks: [] },
      componentAdded: { callbacks: [] },
      componentRemoved: { callbacks: [] },
      componentChanged: { callbacks: [] },
      worldReset: { callbacks: [] },
    },
  };

  registerArchetype(world, root);

  initNameSystem(world);
  initRemovalSystem(world);

  return world;
}

/**
 * Resets world to initial state, clearing all entities and caches.
 *
 * Does NOT fire per-entity lifecycle events (entityDestroyed, componentRemoved).
 * For per-entity cleanup, run a "shutdown" schedule before calling resetWorld().
 * Fires the "worldReset" observer event after reset completes.
 *
 * @param world - World instance to reset
 *
 * @example
 * ```typescript
 * // Stop the world (runs shutdown systems), then reset
 * await stop(world);
 * resetWorld(world);
 * ```
 */
export function resetWorld(world: World): void {
  // 1. Clear filters (unregister observer callbacks)
  for (const filter of world.filters.byId.values()) {
    unregisterObserverCallback(world, "archetypeCreated", filter.onArchetypeCreate);
    unregisterObserverCallback(world, "archetypeDestroyed", filter.onArchetypeDelete);
  }
  world.filters.byId.clear();

  // 2. Clear queries (unregister observer callbacks)
  for (const query of world.queries.byId.values()) {
    unregisterObserverCallback(world, "filterDestroyed", query.onFilterDestroy);
  }
  world.queries.byId.clear();

  // 3. Clear archetypes (break circular refs via edges)
  for (const archetype of world.archetypes.byId.values()) {
    archetype.edges.clear();
  }
  world.archetypes.byId.clear();

  // 4. Reinitialize entity registry
  world.entities.byId.clear();
  world.entities.freeIds.length = 0;
  world.entities.nextId = 1;
  world.entities.generations.clear();

  // 5. Create new root archetype
  const newRoot = createArchetype([], new Map());
  world.archetypes.root = newRoot;
  registerArchetype(world, newRoot);

  // 6. Reset execution state
  world.execution.tick = 1;
  world.execution.scheduleLabel = null;
  world.execution.systemId = null;
  world.execution.running = false;
  world.execution.rafHandle = null;
  world.execution.startupRan = false;
  world.execution.shutdownRan = false;

  // 7. Reset schedule state (preserve pipeline configuration)
  world.schedules.byId.clear();
  world.schedules.dirty = true;

  // 8. Clear caches
  world.events.byId.clear();
  world.actions.byInitializer.clear();

  // 9. Fire worldReset event (subsystems handle their own reset via this observer)
  fireObserverEvent(world, "worldReset", world);
}
