import type { ActionInitializer, Actions } from "./actions.js";
import type { Archetype } from "./archetype.js";
import { createArchetype, registerArchetype } from "./archetype.js";
import type { Component, EntityId, Relation, Tag } from "./encoding.js";
import type { EntityMeta } from "./entity.js";
import { assert, IrisInvalidState } from "./error.js";
import type { EventId, EventQueueMeta } from "./event.js";
import type { FilterMeta } from "./filters.js";
import { initFilterDispatch } from "./filters.js";
import { initNameSystem, resetNameSystem } from "./name.js";
import type { EventType, ObserverMeta } from "./observer.js";
import { fireObserverEvent } from "./observer.js";
import type { QueryMeta, QueryModifier, QueryTrieNode } from "./query.js";
import type { ComponentMeta } from "./registry.js";
import { COMPONENT_REGISTRY } from "./registry.js";
import { initRemovalSystem } from "./removal.js";
import type { ScheduleLabel, SystemMeta, SystemSetLabel, SystemSetMeta } from "./scheduler.js";
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

    /**
     * Name lookup (name -> entity ID).
     */
    byName: Map<string, EntityId>;

    /**
     * Reverse name lookup (entity ID -> name).
     */
    names: Map<EntityId, string>;
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

    /**
     * Reverse index: type ID -> filters that include it.
     */
    byType: Map<EntityId, FilterMeta[]>;
  };

  /**
   * Query registry for metadata caching.
   */
  queries: {
    /**
     * Query metadata lookup (query hash -> metadata).
     */
    byId: Map<string, QueryMeta>;

    /**
     * Parametric query caches keyed by builder function identity.
     */
    byBuilder: Map<(...args: EntityId[]) => (EntityId | QueryModifier)[], QueryTrieNode>;
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
   * System set registry.
   */
  systemSets: {
    /**
     * System set metadata by label.
     */
    byId: Map<SystemSetLabel, SystemSetMeta>;
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
     * Frame counter. Starts and resets at 0, then increments once per accepted
     * manual or animation frame attempt, including empty and failed attempts.
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
     * Current frame promise.
     */
    framePromise: Promise<void> | null;

    /**
     * Current shutdown promise.
     */
    shutdownPromise: Promise<void> | null;

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
  const root = createArchetype([], new Map());

  const world: World = {
    entities: {
      byId: new Map(),
      byName: new Map(),
      names: new Map(),
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
      byType: new Map(),
    },
    queries: {
      byId: new Map(),
      byBuilder: new Map(),
    },
    systems: {
      byId: new Map(),
      nextIndex: 0,
    },
    systemSets: {
      byId: new Map(),
    },
    schedules: {
      byId: new Map(),
      pipeline: [First, PreUpdate, Update, PostUpdate, Last],
      dirty: true,
    },
    execution: {
      scheduleLabel: null,
      systemId: null,
      tick: 0,
      running: false,
      rafHandle: null,
      framePromise: null,
      shutdownPromise: null,
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
      entityCreated: { callbacks: [] },
      entityDestroying: { callbacks: [] },
      entityDestroyed: { callbacks: [] },
      componentAdded: { callbacks: [] },
      componentRemoved: { callbacks: [] },
      componentChanged: { callbacks: [] },
      worldReset: { callbacks: [] },
      scheduleStarted: { callbacks: [] },
      scheduleFinished: { callbacks: [] },
      systemStarted: { callbacks: [] },
      systemFinished: { callbacks: [] },
    },
    revision: 1,
  };

  initFilterDispatch(world);
  registerArchetype(world, root);

  initNameSystem(world);
  initRemovalSystem(world);

  return world;
}

/**
 * Resets world to initial state, clearing all entities and caches.
 *
 * Does NOT fire teardown events (entityDestroying, entityDestroyed, componentRemoved,
 * archetypeDestroyed): observers should treat "worldReset" as "discard every cached
 * entity and archetype".
 * For per-entity cleanup, run a "shutdown" schedule before calling resetWorld().
 * Factory systems and attached conditions initialize again before the next
 * `runOnce()` or `stop()`.
 * Queries cached before the reset are invalidated: they match nothing afterwards
 * and must be re-created with `cacheQuery()`.
 * Fires the "worldReset" observer event after reset completes.
 *
 * @param world - World instance to reset
 * @throws {IrisInvalidState} If scheduler execution is active
 *
 * @example
 * ```typescript
 * // Stop the world (runs shutdown systems), then reset
 * await stop(world);
 * resetWorld(world);
 * ```
 */
export function resetWorld(world: World): void {
  assert(
    !world.execution.running && world.execution.framePromise === null && world.execution.shutdownPromise === null,
    IrisInvalidState,
    { message: "Cannot reset world while scheduler execution is active" }
  );

  world.revision = 1;

  // 1. Clear filters and reverse index
  for (const filter of world.filters.byId.values()) {
    filter.archetypes.length = 0;
  }

  world.filters.byId.clear();
  world.filters.byType.clear();

  // 2. Clear queries
  world.queries.byId.clear();
  world.queries.byBuilder.clear();

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

  // 5. Reset execution state
  world.execution.tick = 0;
  world.execution.scheduleLabel = null;
  world.execution.systemId = null;
  world.execution.running = false;
  world.execution.rafHandle = null;
  world.execution.framePromise = null;
  world.execution.shutdownPromise = null;
  world.execution.startupRan = false;
  world.execution.shutdownRan = false;

  // 6. Reset schedule state (preserve pipeline configuration)
  for (const meta of world.systems.byId.values()) {
    if (meta.factory !== null) {
      meta.runner = null;
    }
    if (meta.conditionFactory !== null) {
      meta.conditionRunner = null;
    }
  }
  for (const meta of world.systemSets.byId.values()) {
    if (meta.conditionFactory !== null) {
      meta.conditionRunner = null;
    }
  }
  world.schedules.byId.clear();
  world.schedules.dirty = true;

  // 7. Clear caches
  world.events.byId.clear();
  world.actions.byInitializer.clear();

  // 8. Recreate root archetype and internal resources
  const newRoot = createArchetype([], new Map());
  world.archetypes.root = newRoot;
  registerArchetype(world, newRoot);
  resetNameSystem(world);

  // 9. Fire worldReset event
  fireObserverEvent(world, "worldReset", world);
}
