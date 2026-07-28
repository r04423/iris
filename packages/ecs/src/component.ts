import type { Archetype, Column } from "./archetype.js";
import { archetypeTraverseAdd, archetypeTraverseRemove, destroyArchetype, getColumnStride } from "./archetype.js";
import type { Component, Entity, EntityId, EntityWith, Pair, Relation, Tag } from "./encoding.js";
import { encodePair, extractPairRelationId, extractPairTargetId, extractPairTargetType, isPair } from "./encoding.js";
import type { EntityMeta } from "./entity.js";
import { ensureEntity, getEntityMeta, moveEntityToArchetype } from "./entity.js";
import { IrisInvalidPair } from "./error.js";
import { fireObserverEvent } from "./observer.js";
import { Exclusive, Wildcard } from "./registry.js";
import { getPairRelation, getPairTarget } from "./relation.js";
import type {
  InferSchema,
  InferSchemaRecord,
  ScalarFields,
  SchemaRecord,
  TypedArrayInstance,
  VectorFields,
} from "./schema.js";
import type { World } from "./world.js";

// ============================================================================
// Component Operations (Public API)
// ============================================================================

export function addComponent(
  world: World,
  entityId: EntityId,
  componentId: Entity | Tag | Pair<Relation<Record<string, never>>>
): void;

export function addComponent<S extends SchemaRecord>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  data: InferSchemaRecord<S>
): void;

/**
 * Add component to entity.
 *
 * Moves entity to new archetype with component. Idempotent if already present.
 * For data components/pairs, pass initial field values.
 *
 * @param world - World instance
 * @param entityId - Entity to modify
 * @param componentId - Tag, data component, or pair to add
 * @param data - Initial field values for data components (optional)
 *
 * @example
 * addComponent(world, entity, Player);
 * addComponent(world, entity, Position, { x: 0, y: 0 });
 * addComponent(world, child, pair(ChildOf, parent));
 */
export function addComponent<S extends SchemaRecord>(
  world: World,
  entityId: EntityId,
  componentId: EntityId,
  data?: InferSchemaRecord<S>
): void {
  const meta = ensureEntity(world, entityId);

  // Idempotent: already has component
  if (meta.archetype.typesSet.has(componentId)) {
    return;
  }

  const { schema } = ensureEntity(world, componentId);

  if (!isPair(componentId)) {
    moveEntityToArchetype(world, meta, archetypeTraverseAdd(world, meta.archetype, componentId, schema));

    // Fire after move so observers can access component data
    if (data !== undefined && writeComponentData(world, meta, componentId, data)) {
      fireObserverEvent(world, "componentChanged", componentId, entityId);
    }

    fireObserverEvent(world, "componentAdded", componentId, entityId);

    return;
  }

  const relation = getPairRelation(componentId);
  const target = getPairTarget(world, componentId);

  if (relation === Wildcard || target === Wildcard) {
    throw new IrisInvalidPair("concrete pair", "wildcard pair (wildcards are query patterns)");
  }

  const targetWildcard = encodePair(Wildcard, target);
  const relationWildcard = encodePair(relation, Wildcard);

  let toArchetype = meta.archetype;
  let removedPair: Pair | undefined;
  let removedTargetWildcard: Pair | undefined;

  // Exclusive replacement rides along in this transition so observers never see
  // an intermediate state where the entity has both targets or neither
  if (hasComponent(world, relation, Exclusive)) {
    removedPair = findPairBehindAggregate(meta.archetype, relationWildcard);
  }

  if (removedPair !== undefined) {
    const oldTargetWildcard = encodePair(Wildcard, getPairTarget(world, removedPair));

    // The incoming pair keeps the relation aggregate alive, so only the old target's can drop
    const targetKept = hasSiblingWithTarget(meta.archetype, removedPair, oldTargetWildcard);

    toArchetype = archetypeTraverseRemove(world, toArchetype, removedPair);

    if (!targetKept) {
      removedTargetWildcard = oldTargetWildcard;
      toArchetype = archetypeTraverseRemove(world, toArchetype, oldTargetWildcard);
    }
  }

  toArchetype = archetypeTraverseAdd(world, toArchetype, componentId, schema);

  // Add the query aggregates. Traversal is a no-op for one inherited from a sibling pair
  let next = archetypeTraverseAdd(world, toArchetype, targetWildcard);
  const addedTargetWildcard = next !== toArchetype;
  toArchetype = next;

  next = archetypeTraverseAdd(world, toArchetype, relationWildcard);
  const addedRelationWildcard = next !== toArchetype;
  toArchetype = next;

  moveEntityToArchetype(world, meta, toArchetype);

  const dataWritten = data !== undefined && writeComponentData(world, meta, componentId, data);

  markPairTopologyChanged(world, meta, componentId);

  if (removedPair !== undefined) {
    markPairTopologyChanged(world, meta, removedPair);
    fireObserverEvent(world, "componentRemoved", removedPair, entityId);
  }

  if (removedTargetWildcard !== undefined) {
    fireObserverEvent(world, "componentRemoved", removedTargetWildcard, entityId);
  }

  if (dataWritten) {
    fireObserverEvent(world, "componentChanged", componentId, entityId);
  }

  // Fire after move so observers can access component data
  fireObserverEvent(world, "componentAdded", componentId, entityId);

  // Aggregates are components too, so observers hear about them like any other type
  if (addedTargetWildcard) {
    fireObserverEvent(world, "componentAdded", targetWildcard, entityId);
  }

  if (addedRelationWildcard) {
    fireObserverEvent(world, "componentAdded", relationWildcard, entityId);
  }
}

// ============================================================================
// Batch Component Operations (Public API)
// ============================================================================

/**
 * Entry for batch component operations.
 *
 * Either a standalone ID (tag, entity, schema-less pair) or a `[component, data]` tuple
 * for data components and pairs with schemas.
 */
export type ComponentEntry = EntityId | readonly [EntityId, Record<string, unknown>];

/**
 * Validates each entry in a component entries tuple at compile time.
 *
 * Data components and pairs with schemas require matching typed data.
 * Tags, entities, and schema-less pairs pass through unchanged.
 */
export type ValidateEntries<T extends readonly ComponentEntry[]> = {
  [I in keyof T]: T[I] extends readonly [infer C, unknown]
    ? C extends Component<infer S>
      ? readonly [C, InferSchemaRecord<S>]
      : C extends Pair<Relation<infer S>>
        ? S extends Record<string, never>
          ? C
          : readonly [C, InferSchemaRecord<S>]
        : C extends Entity | Tag
          ? C
          : T[I]
    : T[I] extends Component<infer S>
      ? readonly [T[I], InferSchemaRecord<S>]
      : T[I] extends Pair<Relation<infer S>>
        ? S extends Record<string, never>
          ? T[I]
          : readonly [T[I], InferSchemaRecord<S>]
        : T[I];
};

/**
 * Add multiple components to an entity in one call.
 *
 * Each entry is either a standalone ID (tag/entity/schema-less pair) or a
 * `[component, data]` tuple for data components and pairs with schemas.
 *
 * @param world - World instance
 * @param entityId - Entity to modify
 * @param entries - Array of component entries
 *
 * @example
 * ```typescript
 * addComponents(world, entity, [
 *   [Position, { x: 0, y: 0 }],
 *   [Velocity, { vx: 1, vy: 0 }],
 *   Player,
 * ]);
 * ```
 */
export function addComponents<const T extends readonly ComponentEntry[]>(
  world: World,
  entityId: EntityId,
  entries: T & ValidateEntries<T>
): void;

export function addComponents(world: World, entityId: EntityId, entries: readonly ComponentEntry[]): void {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;

    if (typeof entry === "number") {
      addComponent(world, entityId, entry as Entity | Tag | Pair<Relation<Record<string, never>>>);
    } else {
      const [componentId, data] = entry;

      addComponent(
        world,
        entityId,
        componentId as Component<SchemaRecord> | Pair<Relation<SchemaRecord>>,
        data as InferSchemaRecord<SchemaRecord>
      );
    }
  }
}

/**
 * Remove component from entity.
 *
 * Moves entity to new archetype without component. Idempotent if not present.
 *
 * @param world - World instance
 * @param entityId - Entity to modify
 * @param componentId - Component to remove
 * @throws {IrisInvalidPair} If the component is a wildcard pair
 *
 * @example
 * ```typescript
 * addComponent(world, entity, tag);
 * removeComponent(world, entity, tag);
 * ```
 */
export function removeComponent(world: World, entityId: EntityId, componentId: EntityId): void {
  const meta = ensureEntity(world, entityId);

  let toArchetype = archetypeTraverseRemove(world, meta.archetype, componentId);

  // Idempotent: component not present
  if (toArchetype === meta.archetype) {
    return;
  }

  if (!isPair(componentId)) {
    moveEntityToArchetype(world, meta, toArchetype);

    // Fire after move so observers see the entity's new archetype
    fireObserverEvent(world, "componentRemoved", componentId, entityId);

    return;
  }

  const relation = getPairRelation(componentId);
  const target = getPairTarget(world, componentId);

  if (relation === Wildcard || target === Wildcard) {
    throw new IrisInvalidPair("concrete pair", "wildcard pair (maintained automatically)");
  }

  const targetWildcard = encodePair(Wildcard, target);
  const relationWildcard = encodePair(relation, Wildcard);

  // Aggregates are shared, so they only drop once the last pair needing them goes
  const removedTargetWildcard = !hasSiblingWithTarget(meta.archetype, componentId, targetWildcard);
  const removedRelationWildcard = !hasSiblingWithRelation(meta.archetype, componentId, relationWildcard);

  if (removedTargetWildcard) {
    toArchetype = archetypeTraverseRemove(world, toArchetype, targetWildcard);
  }

  if (removedRelationWildcard) {
    toArchetype = archetypeTraverseRemove(world, toArchetype, relationWildcard);
  }

  moveEntityToArchetype(world, meta, toArchetype);
  markPairTopologyChanged(world, meta, componentId);

  // Fire after move so observers see the entity's new archetype
  fireObserverEvent(world, "componentRemoved", componentId, entityId);

  // Aggregates are components too, so observers hear about them like any other type
  if (removedTargetWildcard) {
    fireObserverEvent(world, "componentRemoved", targetWildcard, entityId);
  }

  if (removedRelationWildcard) {
    fireObserverEvent(world, "componentRemoved", relationWildcard, entityId);
  }
}

/**
 * Check if entity has component.
 *
 * Returns false if the component is not present.
 *
 * @param world - World instance
 * @param entityId - Entity to check
 * @param componentId - Component to check
 * @returns True if entity has component
 * @throws {IrisEntityNotFound} If the entity is not alive in the world
 *
 * @example
 * ```typescript
 * addComponent(world, entity, tag);
 * hasComponent(world, entity, tag);  // true
 * ```
 */
export function hasComponent<C extends EntityId>(
  world: World,
  entityId: EntityId,
  componentId: C
): entityId is EntityWith<C> {
  const meta = ensureEntity(world, entityId);

  return meta.archetype.typesSet.has(componentId);
}

/**
 * Get component field value.
 *
 * @param world - World instance
 * @param entityId - Entity to query
 * @param componentId - Data component
 * @param fieldName - Field name
 * @returns Field value, or undefined if component/field not present (unnarrowed path)
 *
 * @example
 * ```typescript
 * const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });
 * const x = getComponentValue(world, entity, Position, 'x');
 * ```
 */
export function getComponentValue<S extends SchemaRecord, N extends string, K extends ScalarFields<S>>(
  world: World,
  entityId: EntityWith<Component<S, N>>,
  componentId: Component<S, N>,
  fieldName: K
): InferSchema<S[K]>;

export function getComponentValue<S extends SchemaRecord, N extends string, T, K extends ScalarFields<S>>(
  world: World,
  entityId: EntityWith<Pair<Relation<S, N>, T>>,
  componentId: Pair<Relation<S, N>, T>,
  fieldName: K
): InferSchema<S[K]>;

export function getComponentValue<S extends SchemaRecord, K extends ScalarFields<S>>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  fieldName: K
): InferSchema<S[K]> | undefined;

export function getComponentValue<S extends SchemaRecord, K extends ScalarFields<S>>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  fieldName: K
): InferSchema<S[K]> | undefined {
  const { archetype, row } = ensureEntity(world, entityId);

  const column = resolveColumn(archetype, componentId, fieldName as string);

  if (!column) {
    return;
  }

  return column[row] as InferSchema<S[K]>;
}

/**
 * Set component field value.
 *
 * @param world - World instance
 * @param entityId - Entity to modify
 * @param componentId - Data component
 * @param fieldName - Field name
 * @param value - New value
 *
 * @example
 * ```typescript
 * addComponent(world, entity, Position, { x: 0.0, y: 0.0 });
 * setComponentValue(world, entity, Position, 'x', 10.0);
 * ```
 */
export function setComponentValue<S extends SchemaRecord, N extends string, K extends ScalarFields<S>>(
  world: World,
  entityId: EntityWith<Component<S, N>>,
  componentId: Component<S, N>,
  fieldName: K,
  value: InferSchema<S[K]>
): void;

export function setComponentValue<S extends SchemaRecord, N extends string, T, K extends ScalarFields<S>>(
  world: World,
  entityId: EntityWith<Pair<Relation<S, N>, T>>,
  componentId: Pair<Relation<S, N>, T>,
  fieldName: K,
  value: InferSchema<S[K]>
): void;

export function setComponentValue<S extends SchemaRecord, K extends ScalarFields<S>>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  fieldName: K,
  value: InferSchema<S[K]>
): void;

export function setComponentValue<S extends SchemaRecord, K extends ScalarFields<S>>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  fieldName: K,
  value: InferSchema<S[K]>
): void {
  const { archetype, row } = ensureEntity(world, entityId);

  const column = resolveColumn(archetype, componentId, fieldName as string);

  if (!column) {
    return;
  }

  column[row] = value;

  markChanged(world, archetype, row, componentId, entityId);
}

/**
 * Mark a component as changed without setting a value.
 *
 * No-op if the entity does not have the component.
 *
 * @param world - World instance
 * @param entityId - Entity with the component
 * @param componentId - Component that was changed
 *
 * @example
 * emitComponentChanged(world, entity, Position);  // Notify change tracking
 */
export function emitComponentChanged(world: World, entityId: EntityId, componentId: EntityId): void {
  const { archetype, row } = ensureEntity(world, entityId);

  if (!archetype.typesSet.has(componentId)) {
    return;
  }

  markChanged(world, archetype, row, componentId, entityId);
}

// ============================================================================
// Column Access Internals
// ============================================================================

/**
 * Look up the column backing one field of a component on an archetype.
 *
 * Returns undefined when the archetype lacks the component, or when the component
 * has no such field -- both are the "not present" case for the value accessors.
 *
 * @param archetype - Archetype holding the entity
 * @param componentId - Component or pair owning the columns
 * @param fieldName - Field to resolve
 * @returns The column, or undefined if component or field is absent
 */
function resolveColumn(archetype: Archetype, componentId: EntityId, fieldName: string): Column | undefined {
  return archetype.columns.get(componentId)?.[fieldName];
}

/**
 * Stamp the change tick and notify observers that a component was written.
 *
 * Callers establish that the entity has the component first, so its tick columns
 * exist alongside the data columns.
 *
 * @param world - World instance
 * @param archetype - Archetype holding the entity
 * @param row - Entity's row within the archetype
 * @param componentId - Component or pair that changed
 * @param entityId - Entity that owns the component
 */
function markChanged(world: World, archetype: Archetype, row: number, componentId: EntityId, entityId: EntityId): void {
  const ticks = archetype.ticks.get(componentId);

  if (ticks) {
    ticks.changed[row] = world.revision;
  }

  fireObserverEvent(world, "componentChanged", componentId, entityId);
}

// ============================================================================
// Transition Internals
// ============================================================================

/**
 * Write initial field values into an entity's columns.
 *
 * Written inline rather than through the value setters: the archetype and row are
 * already resolved here, and vector fields need stride-aware writes.
 *
 * @param world - World instance
 * @param meta - Entity metadata, already moved to its new archetype
 * @param componentId - Component or pair owning the columns
 * @param data - Field values to write
 * @returns True if columns were written, false when the component stores nothing
 */
function writeComponentData(
  world: World,
  meta: EntityMeta,
  componentId: EntityId,
  data: Record<string, unknown>
): boolean {
  const { archetype, row } = meta;
  const fieldColumns = archetype.columns.get(componentId);

  if (!fieldColumns) {
    return false;
  }

  for (const fieldName in data) {
    const column = fieldColumns[fieldName];

    if (!column) {
      continue;
    }

    const value = data[fieldName];
    const stride = getColumnStride(column, archetype.capacity);

    if (stride === 1) {
      column[row] = value;
    } else {
      const offset = row * stride;

      for (let i = 0; i < stride; i++) {
        column[offset + i] = (value as number[])[i]!;
      }
    }
  }

  const ticks = archetype.ticks.get(componentId);

  if (ticks) {
    ticks.changed[row] = world.revision;
  }

  return true;
}

/**
 * Check whether another pair on the entity still points at this pair's target.
 *
 * `pair(Wildcard, target)` is shared by every pair with that target, so it may only be
 * dropped once the last one goes. The aggregate itself is skipped since it shares the
 * target; `pair(relation, Wildcard)` cannot match because its target is the wildcard.
 *
 * Targets are compared while still encoded, which avoids resolving entity targets
 * through the generation map. Encoding drops generation, so the comparison agrees
 * with `getPairTarget`.
 *
 * @param archetype - Archetype holding the entity before the transition
 * @param pairId - Concrete pair being added or removed
 * @param targetWildcard - `pair(Wildcard, target)` aggregate to skip
 * @returns True if the target aggregate must stay
 */
function hasSiblingWithTarget(archetype: Archetype, pairId: Pair, targetWildcard: Pair): boolean {
  const { types } = archetype;
  const targetId = extractPairTargetId(pairId);
  const targetType = extractPairTargetType(pairId);

  for (let i = 0; i < types.length; i++) {
    const typeId = types[i]!;

    if (typeId === pairId || typeId === targetWildcard || !isPair(typeId)) {
      continue;
    }

    if (extractPairTargetId(typeId) === targetId && extractPairTargetType(typeId) === targetType) {
      return true;
    }
  }

  return false;
}

/**
 * Check whether another pair on the entity still uses this pair's relation.
 *
 * The mirror of {@link hasSiblingWithTarget}: `pair(Wildcard, target)` cannot match
 * because it carries the wildcard relation.
 *
 * @param archetype - Archetype holding the entity before the transition
 * @param pairId - Concrete pair being removed
 * @param relationWildcard - `pair(relation, Wildcard)` aggregate to skip
 * @returns True if the relation aggregate must stay
 */
function hasSiblingWithRelation(archetype: Archetype, pairId: Pair, relationWildcard: Pair): boolean {
  const { types } = archetype;
  const relationId = extractPairRelationId(pairId);

  for (let i = 0; i < types.length; i++) {
    const typeId = types[i]!;

    if (typeId === pairId || typeId === relationWildcard || !isPair(typeId)) {
      continue;
    }

    if (extractPairRelationId(typeId) === relationId) {
      return true;
    }
  }

  return false;
}

/**
 * Find the concrete pair behind a relation aggregate.
 *
 * An exclusive relation has at most one, which is the target it currently holds.
 *
 * @param archetype - Archetype holding the entity
 * @param relationWildcard - `pair(relation, Wildcard)` aggregate to search behind
 * @returns The concrete pair, or undefined if the relation is unused
 */
function findPairBehindAggregate(archetype: Archetype, relationWildcard: Pair): Pair | undefined {
  const { types } = archetype;
  const relationId = extractPairRelationId(relationWildcard);

  for (let i = 0; i < types.length; i++) {
    const typeId = types[i]!;

    if (typeId !== relationWildcard && isPair(typeId) && extractPairRelationId(typeId) === relationId) {
      return typeId;
    }
  }

  return;
}

/**
 * Mark surviving wildcard pair aggregates as changed after a relationship topology update.
 *
 * @param world - World instance
 * @param meta - Entity metadata after the archetype transition
 * @param pairId - Concrete pair added or removed by the topology update
 */
function markPairTopologyChanged(world: World, meta: EntityMeta, pairId: Pair): void {
  const relation = getPairRelation(pairId);
  const target = getPairTarget(world, pairId);

  if (relation === Wildcard || target === Wildcard) {
    return;
  }

  const relationTicks = meta.archetype.ticks.get(encodePair(relation, Wildcard));

  if (relationTicks) {
    relationTicks.changed[meta.row] = world.revision;
  }

  const targetTicks = meta.archetype.ticks.get(encodePair(Wildcard, target));

  if (targetTicks) {
    targetTicks.changed[meta.row] = world.revision;
  }
}

// ============================================================================
// Vector Component Operations (Public API)
// ============================================================================

/**
 * Get vector component field value as a tuple copy.
 *
 * Returns a new array containing the vector elements. Mutations to the
 * returned array do not affect the stored data.
 *
 * @param world - World instance
 * @param entityId - Entity to query
 * @param componentId - Data component or relation pair with vector field
 * @param fieldName - Vector field name
 * @returns Tuple copy of vector value, or undefined if component/field not present
 *
 * @example
 * ```typescript
 * const Position = defineComponent("Position", { value: Type.f32(2) });
 * const pos = getComponentVectorValue(world, entity, Position, "value"); // [number, number]
 * ```
 */
export function getComponentVectorValue<S extends SchemaRecord, N extends string, K extends VectorFields<S>>(
  world: World,
  entityId: EntityWith<Component<S, N>>,
  componentId: Component<S, N>,
  fieldName: K
): InferSchema<S[K]>;

export function getComponentVectorValue<S extends SchemaRecord, N extends string, T, K extends VectorFields<S>>(
  world: World,
  entityId: EntityWith<Pair<Relation<S, N>, T>>,
  componentId: Pair<Relation<S, N>, T>,
  fieldName: K
): InferSchema<S[K]>;

export function getComponentVectorValue<S extends SchemaRecord, K extends VectorFields<S>>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  fieldName: K
): InferSchema<S[K]> | undefined;

export function getComponentVectorValue<S extends SchemaRecord, K extends VectorFields<S>>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  fieldName: K
): InferSchema<S[K]> | undefined {
  const { archetype, row } = ensureEntity(world, entityId);

  const column = resolveColumn(archetype, componentId, fieldName as string);

  if (!column) {
    return;
  }

  const stride = getColumnStride(column, archetype.capacity);
  const offset = row * stride;
  const result = [];

  for (let i = 0; i < stride; i++) {
    result[i] = column[offset + i];
  }

  return result as InferSchema<S[K]>;
}

/**
 * Set vector component field value from a tuple.
 *
 * Copies the tuple elements into the interleaved column. Updates change
 * detection tick and fires componentChanged observer.
 *
 * @param world - World instance
 * @param entityId - Entity to modify
 * @param componentId - Data component or relation pair with vector field
 * @param fieldName - Vector field name
 * @param value - Tuple of values to set
 *
 * @example
 * ```typescript
 * const Position = defineComponent("Position", { value: Type.f32(2) });
 * setComponentVectorValue(world, entity, Position, "value", [10, 20]);
 * ```
 */
export function setComponentVectorValue<S extends SchemaRecord, N extends string, K extends VectorFields<S>>(
  world: World,
  entityId: EntityWith<Component<S, N>>,
  componentId: Component<S, N>,
  fieldName: K,
  value: InferSchema<S[K]>
): void;

export function setComponentVectorValue<S extends SchemaRecord, N extends string, T, K extends VectorFields<S>>(
  world: World,
  entityId: EntityWith<Pair<Relation<S, N>, T>>,
  componentId: Pair<Relation<S, N>, T>,
  fieldName: K,
  value: InferSchema<S[K]>
): void;

export function setComponentVectorValue<S extends SchemaRecord, K extends VectorFields<S>>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  fieldName: K,
  value: InferSchema<S[K]>
): void;

export function setComponentVectorValue<S extends SchemaRecord, K extends VectorFields<S>>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  fieldName: K,
  value: InferSchema<S[K]>
): void {
  const { archetype, row } = ensureEntity(world, entityId);

  const column = resolveColumn(archetype, componentId, fieldName as string);

  if (!column) {
    return;
  }

  const stride = getColumnStride(column, archetype.capacity);
  const offset = row * stride;

  for (let i = 0; i < stride; i++) {
    column[offset + i] = (value as number[])[i]!;
  }

  markChanged(world, archetype, row, componentId, entityId);
}

/**
 * Get a zero-copy typed array view into a vector component field.
 *
 * Returns a `subarray` view that shares the underlying buffer. Mutations
 * to the view directly modify the stored data. Any structural change to the
 * entity's archetype invalidates the view -- capacity growth, add/remove
 * component, or destroying any entity in the same archetype.
 *
 * @param world - World instance
 * @param entityId - Entity to query
 * @param componentId - Data component or relation pair with vector field
 * @param fieldName - Vector field name
 * @returns Typed array view into the vector, or undefined if component/field not present
 *
 * @example
 * ```typescript
 * const Position = defineComponent("Position", { value: Type.f32(2) });
 * const view = getComponentVectorView(world, entity, Position, "value"); // Float32Array
 * view[0] += 1.0; // direct mutation, no copy
 * ```
 */
export function getComponentVectorView<S extends SchemaRecord, N extends string, K extends VectorFields<S>>(
  world: World,
  entityId: EntityWith<Component<S, N>>,
  componentId: Component<S, N>,
  fieldName: K
): TypedArrayInstance;

export function getComponentVectorView<S extends SchemaRecord, N extends string, T, K extends VectorFields<S>>(
  world: World,
  entityId: EntityWith<Pair<Relation<S, N>, T>>,
  componentId: Pair<Relation<S, N>, T>,
  fieldName: K
): TypedArrayInstance;

export function getComponentVectorView<S extends SchemaRecord, K extends VectorFields<S>>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  fieldName: K
): TypedArrayInstance | undefined;

export function getComponentVectorView<S extends SchemaRecord, K extends VectorFields<S>>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  fieldName: K
): TypedArrayInstance | undefined {
  const { archetype, row } = ensureEntity(world, entityId);

  const column = resolveColumn(archetype, componentId, fieldName as string);

  if (!column || Array.isArray(column)) {
    return;
  }

  const stride = getColumnStride(column, archetype.capacity);
  const offset = row * stride;

  return column.subarray(offset, offset + stride) as TypedArrayInstance;
}

// ============================================================================
// Component Cleanup
// ============================================================================

/**
 * Remove component from all entities that have it.
 *
 * @param world - World instance
 * @param componentId - Component to remove from all entities
 */
export function cascadeRemoveComponent(world: World, componentId: EntityId): void {
  const meta = getEntityMeta(world, componentId)!;

  // Copy records - will be modified during iteration as entities move
  const archetypes = [...meta.records];

  for (const archetype of archetypes) {
    // Iterate backward for deletion safety (entities removed during iteration)
    for (let i = archetype.entities.length - 1; i >= 0; i--) {
      const entityId = archetype.entities[i]!;

      removeComponent(world, entityId, componentId);
    }

    // Destroy now-invalid archetype (contains dead component type)
    destroyArchetype(world, archetype);
  }
}
