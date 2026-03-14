import type { Entity, EntityId, Observer, World } from "iris-ecs";
import {
  ENTITY_TYPE,
  extractType,
  getName,
  isPair,
  Name,
  registerObserverCallback,
  unregisterObserverCallback,
} from "iris-ecs";
import type { DevToolsStore } from "./store.js";
import type { EntitySnapshot } from "./types.js";

// ============================================================================
// Entity Classification
// ============================================================================

/**
 * Returns true if the given ID represents an entity
 * (not a component, tag, relation, or pair).
 *
 * @internal
 */
function isEntity(entityId: EntityId): boolean {
  if (isPair(entityId)) return false;
  return extractType(entityId) === ENTITY_TYPE;
}

// ============================================================================
// Snapshot Helpers
// ============================================================================

/**
 * Creates an EntitySnapshot for the given entity ID.
 *
 * @internal
 */
function createEntitySnapshot(world: World, entityId: EntityId): EntitySnapshot {
  const meta = world.entities.byId.get(entityId);
  return {
    id: entityId,
    name: getName(world, entityId),
    componentCount: meta ? meta.archetype.types.length : 0,
  };
}

// ============================================================================
// Initial Snapshot
// ============================================================================

/**
 * Iterates all entities in the world and populates the store
 * with snapshots of game entities.
 *
 * @internal
 */
function loadInitialSnapshot(world: World, store: DevToolsStore): void {
  const entities = new Map<EntityId, EntitySnapshot>();
  for (const entityId of world.entities.byId.keys()) {
    if (isEntity(entityId)) {
      entities.set(entityId, createEntitySnapshot(world, entityId));
    }
  }
  store.getState()._loadSnapshot(entities);
}

// ============================================================================
// Bridge
// ============================================================================

/**
 * Attaches observer callbacks that sync world state into the DevTools store.
 * Returns a cleanup function that unregisters all observers.
 *
 * @internal
 */
export function attachBridge(world: World, store: DevToolsStore): () => void {
  loadInitialSnapshot(world, store);

  const onEntityCreated: Observer<"entityCreated"> = (entityId: Entity) => {
    store.getState()._addEntity(createEntitySnapshot(world, entityId));
  };

  const onEntityDestroyed: Observer<"entityDestroyed"> = (entityId: EntityId) => {
    if (store.getState().entities.has(entityId)) {
      store.getState()._removeEntity(entityId);
    }
  };

  const onComponentAdded: Observer<"componentAdded"> = (_componentId: EntityId, entityId: EntityId) => {
    if (!store.getState().entities.has(entityId)) return;
    const meta = world.entities.byId.get(entityId);
    if (meta) {
      store.getState()._updateEntityComponentCount(entityId, meta.archetype.types.length);
    }
  };

  const onComponentRemoved: Observer<"componentRemoved"> = (_componentId: EntityId, entityId: EntityId) => {
    if (!store.getState().entities.has(entityId)) return;
    const meta = world.entities.byId.get(entityId);
    if (meta) {
      store.getState()._updateEntityComponentCount(entityId, meta.archetype.types.length);
    }
  };

  const onComponentChanged: Observer<"componentChanged"> = (componentId: EntityId, entityId: EntityId) => {
    if (componentId !== Name) return;
    if (!store.getState().entities.has(entityId)) return;
    store.getState()._updateEntityName(entityId, getName(world, entityId));
  };

  const onWorldReset: Observer<"worldReset"> = () => {
    store.getState()._reset();
  };

  registerObserverCallback(world, "entityCreated", onEntityCreated);
  registerObserverCallback(world, "entityDestroyed", onEntityDestroyed);
  registerObserverCallback(world, "componentAdded", onComponentAdded);
  registerObserverCallback(world, "componentRemoved", onComponentRemoved);
  registerObserverCallback(world, "componentChanged", onComponentChanged);
  registerObserverCallback(world, "worldReset", onWorldReset);

  return () => {
    unregisterObserverCallback(world, "entityCreated", onEntityCreated);
    unregisterObserverCallback(world, "entityDestroyed", onEntityDestroyed);
    unregisterObserverCallback(world, "componentAdded", onComponentAdded);
    unregisterObserverCallback(world, "componentRemoved", onComponentRemoved);
    unregisterObserverCallback(world, "componentChanged", onComponentChanged);
    unregisterObserverCallback(world, "worldReset", onWorldReset);
  };
}
