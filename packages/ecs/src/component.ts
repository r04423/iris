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

/**
 * Adds a tag, data component, or relation pair to an entity.
 *
 * Idempotent: adding a component the entity already has does nothing. Data
 * components and pairs with schemas require initial field values. Adding a
 * pair on an exclusive relation replaces the previous target in a single
 * transition.
 *
 * Acts as an assertion: after the call the entity is narrowed, making the
 * typed accessors like {@link getComponentValue} return non-optional values.
 *
 * @throws {IrisEntityNotFound} If the entity is not alive
 * @throws {IrisInvalidPair} If the pair contains a wildcard
 *
 * @example
 * ```typescript
 * addComponent(world, entity, Player);
 * addComponent(world, entity, Position, { x: 0, y: 0 });
 * addComponent(world, child, pair(ChildOf, parent));
 * ```
 */
export function addComponent<C extends Entity | Tag | Pair<Relation<Record<string, never>>>>(
  world: World,
  entityId: EntityId,
  componentId: C
): asserts entityId is EntityWith<C>;

export function addComponent<S extends SchemaRecord, N extends string>(
  world: World,
  entityId: EntityId,
  componentId: Component<S, N>,
  data: InferSchemaRecord<S>
): asserts entityId is EntityWith<Component<S, N>>;

export function addComponent<S extends SchemaRecord, N extends string, T>(
  world: World,
  entityId: EntityId,
  componentId: Pair<Relation<S, N>, T>,
  data: InferSchemaRecord<S>
): asserts entityId is EntityWith<Pair<Relation<S, N>, T>>;

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

/** Component IDs carried by an entries tuple; bare entries are the ID itself. */
type EntryComponent<E extends ComponentEntry> = E extends readonly [infer C extends EntityId, unknown] ? C : E;

/**
 * Adds multiple components to an entity in one call.
 *
 * Equivalent to calling {@link addComponent} for each entry in order.
 *
 * Acts as an assertion: after the call the entity is narrowed for every entry,
 * making the typed accessors like {@link getComponentValue} return
 * non-optional values.
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
): asserts entityId is EntityWith<EntryComponent<T[number]>>;

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
        // May also be a data pair; the component overload stands in for both since
        // entries were already validated by ValidateEntries and the overloads share one implementation
        componentId as Component<SchemaRecord>,
        data as InferSchemaRecord<SchemaRecord>
      );
    }
  }
}

/**
 * Removes a component from an entity.
 *
 * Idempotent: removing a component the entity lacks does nothing. Removal is
 * observable through `removed()` events.
 *
 * @throws {IrisEntityNotFound} If the entity is not alive
 * @throws {IrisInvalidPair} If the pair contains a wildcard
 *
 * @example
 * ```typescript
 * removeComponent(world, entity, Poisoned);
 * removeComponent(world, child, pair(ChildOf, parent));
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
 * Checks whether an entity has a component.
 *
 * Acts as a type guard: a true result narrows the entity, making the typed
 * accessors like {@link getComponentValue} return non-optional values.
 *
 * @throws {IrisEntityNotFound} If the entity is not alive
 *
 * @example
 * ```typescript
 * if (hasComponent(world, entity, Position)) {
 *   const x = getComponentValue(world, entity, Position, "x"); // number, not number | undefined
 * }
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
 * Gets a scalar field value from a data component or pair.
 *
 * Returns undefined when the component is absent; narrow with
 * {@link hasComponent} first for a non-optional type. Vector fields use
 * {@link getComponentVectorValue}.
 *
 * @throws {IrisEntityNotFound} If the entity is not alive
 *
 * @example
 * ```typescript
 * const x = getComponentValue(world, entity, Position, "x");
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
 * Sets a scalar field value on a data component or pair.
 *
 * No-op when the component is absent. Marks the component changed for
 * `changed()` query filters.
 *
 * @throws {IrisEntityNotFound} If the entity is not alive
 *
 * @example
 * ```typescript
 * setComponentValue(world, entity, Position, "x", 10.0);
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
 * Marks a component as changed without writing a value.
 *
 * Feeds `changed()` query filters after out-of-band writes -- e.g. mutations
 * through {@link getComponentVectorView}, which bypass change tracking.
 * No-op when the component is absent.
 *
 * @throws {IrisEntityNotFound} If the entity is not alive
 *
 * @example
 * ```typescript
 * const view = getComponentVectorView(world, entity, Position, "value");
 * view[0] += 1.0;
 * markComponentChanged(world, entity, Position);
 * ```
 */
export function markComponentChanged(world: World, entityId: EntityId, componentId: EntityId): void {
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
 * Looks up the column backing one field of a component on an archetype.
 *
 * Undefined covers both missing component and missing field -- the value
 * accessors treat them identically as "not present".
 */
function resolveColumn(archetype: Archetype, componentId: EntityId, fieldName: string): Column | undefined {
  return archetype.columns.get(componentId)?.[fieldName];
}

/**
 * Stamps the change tick and fires `componentChanged`.
 *
 * Callers establish that the entity has the component first, so its tick
 * columns exist alongside the data columns.
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
 * Writes initial field values into an entity's columns.
 *
 * Bypasses the value setters: the archetype and row are already resolved here,
 * and vector fields need stride-aware writes.
 *
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
 * Checks whether another pair on the entity still points at this pair's target,
 * i.e. whether the shared `pair(Wildcard, target)` aggregate must stay.
 *
 * Targets are compared while still encoded: encoding drops generation, so the
 * comparison agrees with `getPairTarget` without resolving through the
 * generation map.
 */
function hasSiblingWithTarget(archetype: Archetype, pairId: Pair, targetWildcard: Pair): boolean {
  const { types } = archetype;
  const targetId = extractPairTargetId(pairId);
  const targetType = extractPairTargetType(pairId);

  for (let i = 0; i < types.length; i++) {
    const typeId = types[i]!;

    // The aggregate itself shares the target; only concrete siblings count
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
 * Checks whether another pair on the entity still uses this pair's relation,
 * i.e. whether the shared `pair(relation, Wildcard)` aggregate must stay.
 *
 * Mirror of {@link hasSiblingWithTarget}.
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
 * Finds the concrete pair behind a `pair(relation, Wildcard)` aggregate.
 * An exclusive relation has at most one: its current target.
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
 * Marks surviving wildcard aggregates as changed after a pair is added or
 * removed, so `changed()` filters on wildcard queries observe topology updates.
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
 * Gets a vector field value as a tuple copy.
 *
 * Mutating the returned array does not affect stored data; use
 * {@link getComponentVectorView} for zero-copy access. Returns undefined when
 * the component is absent; narrow with {@link hasComponent} first for a
 * non-optional type.
 *
 * @throws {IrisEntityNotFound} If the entity is not alive
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
 * Sets a vector field value from a tuple.
 *
 * No-op when the component is absent. Marks the component changed for
 * `changed()` query filters.
 *
 * @throws {IrisEntityNotFound} If the entity is not alive
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
 * Gets a zero-copy typed array view into a vector field.
 *
 * Mutations through the view write directly to stored data, bypassing change
 * detection -- call {@link markComponentChanged} after writing. Any structural
 * change to the entity's archetype invalidates the view: capacity growth,
 * add/remove component, or destroying any entity in the same archetype.
 *
 * @throws {IrisEntityNotFound} If the entity is not alive
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
 * Removes a destroyed component type from every entity that has it, then
 * destroys the emptied archetypes.
 * @internal
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
