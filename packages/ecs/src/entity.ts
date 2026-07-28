import type { Archetype } from "./archetype.js";
import { addEntityToArchetype, removeEntityFromArchetypeByRow, transferEntityToArchetypeByRow } from "./archetype.js";
import type { ComponentEntry, ValidateEntries } from "./component.js";
import { addComponent, addComponents, cascadeRemoveComponent } from "./component.js";
import type { Component, Entity, EntityId, Relation } from "./encoding.js";
import {
  COMPONENT_TYPE,
  ENTITY_TYPE,
  encodeEntity,
  extractEntityId,
  extractMeta,
  extractType,
  ID_MASK_8,
  ID_MASK_20,
  isEntity,
  isPair,
  isRelation,
  RELATIONSHIP_TYPE,
  TAG_TYPE,
} from "./encoding.js";
import { IrisEntityLimitExceeded, IrisEntityNotFound, IrisInvalidState } from "./error.js";
import { fireObserverEvent } from "./observer.js";
import { Exclusive, OnDeleteTarget } from "./registry.js";
import { cleanupPairsTargetingEntity, cleanupPairsUsingRelation, getPairRelation, getPairTarget } from "./relation.js";
import type { SchemaRecord } from "./schema.js";
import type { World } from "./world.js";

// ============================================================================
// Entity Metadata
// ============================================================================

/**
 * Entity metadata: current location (archetype + row) and component records.
 * @internal
 */
export type EntityMeta = {
  /** Encoded ID this metadata belongs to. */
  id: EntityId;
  /** Current archetype (direct reference). */
  archetype: Archetype;
  /** Row index in archetype.entities. */
  row: number;
  /** Component records: which archetypes contain this entity as a component. */
  records: Archetype[];
  /** Schema when this entity is used as a component (undefined for regular entities). */
  schema?: SchemaRecord;
  /** Cycle protection flag during cascade delete. */
  destroying?: boolean;
};

// ============================================================================
// Entity State
// ============================================================================

/**
 * Entity registry.
 * @internal
 */
export type EntityState = {
  /** Entity metadata lookup (raw entity ID -> metadata). */
  byRawId: (EntityMeta | undefined)[];
  /** Metadata lookup for tags, components, relations, and pairs. */
  byId: Map<EntityId, EntityMeta>;
  /** Freelist of dead entity raw IDs for recycling. */
  freeIds: number[];
  /** Next raw ID to allocate. */
  nextId: number;
  /** Generation lookup (raw entity ID -> generation). */
  generations: number[];
};

/**
 * Creates an empty entity registry.
 * @internal
 */
export function createEntityState(): EntityState {
  return {
    byRawId: [],
    byId: new Map(),
    freeIds: [],
    nextId: 1,
    generations: [],
  };
}

/**
 * Clears the world's entity registry back to its initial state.
 * @internal
 */
export function resetEntityState(world: World): void {
  world.entities.byRawId.length = 0;
  world.entities.byId.clear();
  world.entities.freeIds.length = 0;
  world.entities.nextId = 1;
  world.entities.generations.length = 0;
}

/**
 * Looks up entity metadata. Returns undefined for dead and stale references.
 * @internal
 */
export function getEntityMeta(world: World, entityId: EntityId): EntityMeta | undefined {
  if (!isEntity(entityId)) {
    return world.entities.byId.get(entityId);
  }

  const meta = world.entities.byRawId[extractEntityId(entityId)];

  if (meta?.id === entityId) {
    return meta;
  }

  return;
}

/**
 * Allocates entity ID, preferring recycled IDs from freelist.
 * Recycled IDs retain their generation for stale reference detection.
 */
function allocateEntityId(world: World): Entity {
  const rawId = world.entities.freeIds.pop();
  if (rawId !== undefined) {
    // Reuse recycled ID with its current generation
    const generation = world.entities.generations[rawId]!;
    return encodeEntity(rawId, generation);
  }

  const newRawId = world.entities.nextId++;

  if (newRawId > ID_MASK_20) {
    throw new IrisEntityLimitExceeded(newRawId);
  }

  world.entities.generations[newRawId] = 0;
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
    id: entityId,
    archetype: rootArchetype,
    row,
    records: [],
    schema,
  };

  if (isEntity(entityId)) {
    world.entities.byRawId[extractEntityId(entityId)] = meta;
  } else {
    world.entities.byId.set(entityId, meta);
  }

  return meta;
}

/**
 * Resolves entity metadata, auto-registering tags, components, relations, and
 * pairs on first use. Throws IrisEntityNotFound for dead entity references and
 * for pairs whose entity target is not alive.
 * @internal
 */
export function ensureEntity(world: World, entityId: EntityId): EntityMeta {
  const meta = getEntityMeta(world, entityId);

  if (meta) {
    return meta;
  }

  // Pairs inherit schema from their relation component
  if (isPair(entityId)) {
    const relation = getPairRelation(entityId);
    const relationMeta = ensureEntity(world, relation);

    // Registering the target keeps every pair's target resolvable
    ensureEntity(world, getPairTarget(world, entityId));

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
      throw new IrisEntityNotFound(entityId);
    }

    default: {
      throw new IrisInvalidState({ message: `Invalid entity type: ${type}` });
    }
  }
}

/**
 * Creates a new entity, optionally with initial components.
 *
 * Component entries are applied in order, exactly as {@link addComponents}
 * would. IDs of destroyed entities are recycled, so treat the returned value
 * as opaque.
 *
 * @throws {IrisEntityLimitExceeded} If the limit of 1,048,575 concurrently allocated IDs is exceeded
 *
 * @example
 * ```typescript
 * const player = createEntity(world, [
 *   [Position, { x: 0, y: 0 }],
 *   Player,
 * ]);
 * ```
 */
export function createEntity(world: World): Entity;

export function createEntity<const T extends readonly ComponentEntry[]>(
  world: World,
  entries: T & ValidateEntries<T>
): Entity;

export function createEntity(world: World, entries?: readonly ComponentEntry[]): Entity {
  const entityId = allocateEntityId(world);
  registerEntity(world, entityId);

  fireObserverEvent(world, "entityCreated", entityId);

  if (entries) {
    addComponents(world, entityId, entries);
  }

  return entityId;
}

/**
 * Destroys an entity and recycles its ID for reuse.
 *
 * Idempotent: destroying a dead entity does nothing. Pairs targeting the
 * entity are removed from their subjects, and subjects related through an
 * `onDeleteTarget: "delete"` relation are destroyed as well -- cascades
 * recurse and are cycle-safe. Stale references to the destroyed entity read
 * as dead via {@link isEntityAlive}, even after its ID is recycled.
 *
 * Also accepts tag, component, and relation IDs: destroying a definition
 * removes it from every entity that has it (relations lose all their pairs).
 * Definition IDs are not recycled.
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

  const meta = getEntityMeta(world, entityId)!;

  // Cycle protection - prevent infinite loops from cascade deletes
  if (meta.destroying) {
    return;
  }
  meta.destroying = true;

  // Clean up pairs targeting this entity (handles cascade delete)
  cleanupPairsTargetingEntity(world, entityId);

  // Clean up pairs built from this entity as their relation
  if (isRelation(entityId)) {
    cleanupPairsUsingRelation(world, entityId);
  }

  // Remove this entity from any entities that have it as a component
  cascadeRemoveComponent(world, entityId);

  // Fires after cascades (which report their own removals) but before the row is
  // vacated, so callbacks can still read the entity's remaining component data
  fireObserverEvent(world, "entityDestroying", entityId);

  const swappedEntityId = removeEntityFromArchetypeByRow(meta.archetype, meta.row);

  // Swap-remove updates: entity swapped into our slot needs row update
  if (swappedEntityId !== undefined) {
    const swappedMeta = getEntityMeta(world, swappedEntityId)!;
    swappedMeta.row = meta.row;
  }

  // Delete before firing so the entity reads as gone
  if (isEntity(entityId)) {
    world.entities.byRawId[extractEntityId(entityId)] = undefined;
  } else {
    world.entities.byId.delete(entityId);
  }

  fireObserverEvent(world, "entityDestroyed", entityId);

  // Only entity IDs are recycled; component/tag/relation IDs are permanent
  if (isEntity(entityId)) {
    const rawId = extractEntityId(entityId);
    const oldGeneration = extractMeta(entityId);
    // Increment generation so stale references become detectable
    const newGeneration = (oldGeneration + 1) & ID_MASK_8;

    world.entities.generations[rawId] = newGeneration;
    world.entities.freeIds.push(rawId);
  }
}

/**
 * Checks if an entity is currently alive in the world.
 *
 * Stale references -- IDs whose entity was destroyed, even if the slot was
 * recycled -- read as dead. Also accepts tag, component, relation, and pair
 * IDs, reporting whether the definition has been registered in this world.
 *
 * @example
 * ```typescript
 * isEntityAlive(world, entity); // true
 * destroyEntity(world, entity);
 * isEntityAlive(world, entity); // false
 * ```
 */
export function isEntityAlive(world: World, entity: EntityId): boolean {
  return getEntityMeta(world, entity) !== undefined;
}

/**
 * Moves an entity to a different archetype, transferring shared component data
 * and patching the row of the entity swapped into its old slot.
 * @internal
 */
export function moveEntityToArchetype(world: World, meta: EntityMeta, toArchetype: Archetype): void {
  const fromRow = meta.row;

  const { toRow, swappedEntityId } = transferEntityToArchetypeByRow(
    meta.archetype,
    meta.row,
    toArchetype,
    world.revision
  );

  meta.archetype = toArchetype;
  meta.row = toRow;

  // Swap-remove updates: entity swapped into our old slot needs row update
  if (swappedEntityId !== undefined) {
    const swappedMeta = getEntityMeta(world, swappedEntityId)!;
    swappedMeta.row = fromRow;
  }
}

/**
 * Records a new archetype on the metadata of every component type it contains.
 * @internal
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
 * Removes a destroyed archetype from the records of every component type it
 * contains.
 * @internal
 */
export function removeEntityRecord(world: World, archetype: Archetype): void {
  for (let i = 0; i < archetype.types.length; i++) {
    const typeId = archetype.types[i]!;
    const meta = getEntityMeta(world, typeId)!;
    const idx = meta.records.indexOf(archetype);

    if (idx !== -1) {
      meta.records.splice(idx, 1);
    }
  }
}
