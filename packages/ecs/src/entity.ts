import type { Archetype } from "./archetype.js";
import { addEntityToArchetype, removeEntityFromArchetypeByRow, transferEntityToArchetypeByRow } from "./archetype.js";
import { addComponent, cascadeRemoveComponent } from "./component.js";
import type { Component, Entity, EntityId, Relation } from "./encoding.js";
import {
  COMPONENT_TYPE,
  ENTITY_TYPE,
  encodeEntity,
  extractId,
  extractMeta,
  extractType,
  ID_MASK_8,
  ID_MASK_20,
  isPair,
  RELATIONSHIP_TYPE,
  TAG_TYPE,
} from "./encoding.js";
import { assert, InvalidState, LimitExceeded, NotFound } from "./error.js";
import { fireObserverEvent } from "./observer.js";
import { Exclusive, OnDeleteTarget } from "./registry.js";
import { cleanupPairsTargetingEntity, getPairRelation } from "./relation.js";
import type { SchemaRecord } from "./schema.js";
import type { World } from "./world.js";

// ============================================================================
// Entity Metadata
// ============================================================================

/**
 * Entity metadata.
 *
 * Stores entity's current location (archetype + row) and component records.
 */
export type EntityMeta = {
  /**
   * Current archetype (direct reference).
   */
  archetype: Archetype;

  /**
   * Row index in archetype.entities.
   */
  row: number;

  /**
   * Component records: which archetypes contain this entity as a component.
   */
  records: Archetype[];

  /**
   * Schema when this entity is used as a component (undefined for regular entities).
   */
  schema?: SchemaRecord;

  /**
   * Cycle protection flag during cascade delete.
   */
  destroying?: boolean;
};

/**
 * Allocates entity ID, preferring recycled IDs from freelist.
 * Recycled IDs retain their generation for stale reference detection.
 */
function allocateEntityId(world: World): Entity {
  const rawId = world.entities.freeIds.pop();
  if (rawId !== undefined) {
    // Reuse recycled ID with its current generation
    const generation = world.entities.generations.get(rawId)!;
    return encodeEntity(rawId, generation);
  }

  const newRawId = world.entities.nextId++;

  assert(newRawId <= ID_MASK_20, LimitExceeded, { resource: "Entity", max: ID_MASK_20, id: newRawId });

  world.entities.generations.set(newRawId, 0);
  return encodeEntity(newRawId, 0);
}

/**
 * Registers entity in root archetype and creates its metadata.
 * Schema is stored when entity is used as a component type.
 */
function registerEntity(world: World, entityId: EntityId, schema?: SchemaRecord): EntityMeta {
  const rootArchetype = world.archetypes.root;
  const row = addEntityToArchetype(rootArchetype, entityId);

  const meta: EntityMeta = {
    archetype: rootArchetype,
    row,
    records: [],
    schema,
  };

  world.entities.byId.set(entityId, meta);

  return meta;
}

/**
 * Ensures entity exists in world, auto-registering components/tags/relations if needed.
 *
 * @param world - World instance
 * @param entityId - Entity or component ID
 * @returns Entity metadata
 * @throws {NotFound} If entity not registered (ENTITY_TYPE)
 * @throws {InvalidState} If unknown entity type
 *
 * @example
 * ```typescript
 * const meta = ensureEntity(world, Position);
 * console.log(meta.archetype);
 * ```
 */
export function ensureEntity(world: World, entityId: EntityId): EntityMeta {
  const meta = world.entities.byId.get(entityId);

  if (meta) {
    return meta;
  }

  // Pairs inherit schema from their relation component
  if (isPair(entityId)) {
    const relation = getPairRelation(entityId);
    const relationMeta = ensureEntity(world, relation);

    return registerEntity(world, entityId, relationMeta.schema);
  }

  const type = extractType(entityId);

  switch (type) {
    case TAG_TYPE: {
      return registerEntity(world, entityId);
    }

    case COMPONENT_TYPE: {
      const componentMeta = world.components.byId.get(entityId as Component);
      return registerEntity(world, entityId, componentMeta?.schema);
    }

    case RELATIONSHIP_TYPE: {
      const relationMeta = world.components.byId.get(entityId as Relation);
      const meta = registerEntity(world, entityId, relationMeta?.schema);

      // Materialize relation traits as queryable components
      if (relationMeta?.exclusive) {
        addComponent(world, entityId, Exclusive);
      }
      if (relationMeta?.onDeleteTarget === "delete") {
        addComponent(world, entityId, OnDeleteTarget);
      }

      return meta;
    }

    case ENTITY_TYPE: {
      throw new NotFound({ resource: "Entity", id: entityId, context: "world" });
    }

    default: {
      throw new InvalidState({ message: `Invalid entity type: ${type}` });
    }
  }
}

/**
 * Creates a new entity in the world.
 *
 * @param world - World instance
 * @returns Encoded entity ID
 * @throws {LimitExceeded} If entity limit (1,048,576) exceeded
 *
 * @example
 * ```typescript
 * const entity = createEntity(world);
 * addComponent(world, entity, Position, { x: 0, y: 0 });
 * ```
 */
export function createEntity(world: World): Entity {
  const entityId = allocateEntityId(world);
  registerEntity(world, entityId);

  fireObserverEvent(world, "entityCreated", entityId);

  return entityId;
}

/**
 * Destroys an entity and recycles its ID for reuse.
 *
 * @param world - World instance
 * @param entityId - Entity to destroy
 *
 * @example
 * ```typescript
 * destroyEntity(world, entity);
 * isEntityAlive(world, entity); // false
 * ```
 */
export function destroyEntity(world: World, entityId: EntityId): void {
  // Idempotent - already destroyed entities are no-ops
  if (!isEntityAlive(world, entityId)) {
    return;
  }

  const meta = world.entities.byId.get(entityId)!;

  // Cycle protection - prevent infinite loops from cascade deletes
  if (meta.destroying) {
    return;
  }
  meta.destroying = true;

  // Clean up pairs targeting this entity (handles cascade delete)
  cleanupPairsTargetingEntity(world, entityId);

  // Remove this entity from any entities that have it as a component
  cascadeRemoveComponent(world, entityId);

  const swappedEntityId = removeEntityFromArchetypeByRow(meta.archetype, meta.row);

  // Swap-remove updates: entity swapped into our slot needs row update
  if (swappedEntityId !== undefined) {
    const swappedMeta = world.entities.byId.get(swappedEntityId)!;
    swappedMeta.row = meta.row;
  }

  fireObserverEvent(world, "entityDestroyed", entityId);

  world.entities.byId.delete(entityId);

  // Only entity IDs are recycled; component/tag/relation IDs are permanent
  if (extractType(entityId) === ENTITY_TYPE) {
    const rawId = extractId(entityId);
    const oldGeneration = extractMeta(entityId);
    // Increment generation so stale references become detectable
    const newGeneration = (oldGeneration + 1) & ID_MASK_8;

    world.entities.generations.set(rawId, newGeneration);
    world.entities.freeIds.push(rawId);
  }
}

/**
 * Checks if an entity is currently alive in the world.
 *
 * @param world - World instance
 * @param entity - Entity ID to check
 * @returns True if entity exists and is alive
 *
 * @example
 * ```typescript
 * isEntityAlive(world, entity); // true
 * destroyEntity(world, entity);
 * isEntityAlive(world, entity); // false
 * ```
 */
export function isEntityAlive(world: World, entity: EntityId): boolean {
  return world.entities.byId.has(entity);
}

/**
 * Moves entity to a different archetype, transferring component data.
 *
 * @param world - World instance
 * @param meta - Entity metadata
 * @param toArchetype - Target archetype
 *
 * @example
 * ```typescript
 * const archetype = getOrCreateArchetype(world, [Position, Velocity]);
 * moveEntityToArchetype(world, meta, archetype);
 * ```
 */
export function moveEntityToArchetype(world: World, meta: EntityMeta, toArchetype: Archetype): void {
  const fromRow = meta.row;

  const { toRow, swappedEntityId } = transferEntityToArchetypeByRow(
    meta.archetype,
    meta.row,
    toArchetype,
    world.execution.tick
  );

  meta.archetype = toArchetype;
  meta.row = toRow;

  // Swap-remove updates: entity swapped into our old slot needs row update
  if (swappedEntityId !== undefined) {
    const swappedMeta = world.entities.byId.get(swappedEntityId)!;
    swappedMeta.row = fromRow;
  }
}

/**
 * Registers archetype in entity records for all its component types.
 *
 * @param world - World instance
 * @param archetype - Archetype to register
 *
 * @example
 * ```typescript
 * const archetype = createArchetype([Position, Velocity]);
 * addEntityRecord(world, archetype);
 * ```
 */
export function addEntityRecord(world: World, archetype: Archetype): void {
  // Each component type tracks which archetypes contain it for query matching
  for (let i = 0; i < archetype.types.length; i++) {
    const typeId = archetype.types[i]!;
    const meta = ensureEntity(world, typeId);
    meta.records.push(archetype);
  }
}

/**
 * Removes archetype from entity records for all its component types.
 *
 * @param world - World instance
 * @param archetype - Archetype to unregister
 *
 * @example
 * ```typescript
 * removeEntityRecord(world, archetype);
 * destroyArchetype(archetype);
 * ```
 */
export function removeEntityRecord(world: World, archetype: Archetype): void {
  for (let i = 0; i < archetype.types.length; i++) {
    const typeId = archetype.types[i]!;
    const meta = world.entities.byId.get(typeId)!;
    const idx = meta.records.indexOf(archetype);

    if (idx !== -1) {
      meta.records.splice(idx, 1);
    }
  }
}
