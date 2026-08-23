import type { Archetype } from "./archetype.js";
import {
  archetypeTraverseAdd,
  archetypeTraverseRemove,
  destroyArchetype,
  readComponentColumns,
  readField,
  stampComponentChanged,
  viewVectorField,
  writeComponentColumns,
  writeField,
} from "./archetype.js";
import type { Component, Entity, EntityId, EntityWith, Pair, Relation, Tag } from "./encoding.js";
import { encodePair, extractPairRelationId, extractPairTargetId, extractPairTargetType, isPair } from "./encoding.js";
import type { EntityMeta } from "./entity.js";
import { ensureEntity, getEntityMeta, moveEntityToArchetype } from "./entity.js";
import { IrisInvalidPair } from "./error.js";
import { fireObserverEvent } from "./observer.js";
import { Exclusive, Wildcard } from "./registry.js";
import { getPairRelation, getPairTarget } from "./relation.js";
import type { InferSchema, InferSchemaRecord, SchemaRecord, TypedArrayInstance, VectorFields } from "./schema.js";
import type { World } from "./world.js";

// ============================================================================
// Component Entries
// ============================================================================

/**
 * Entry for collection-based component attachment.
 *
 * Data-less components are bare IDs. Data-bearing components are
 * `[component, data]` tuples.
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
export type EntryComponent<E extends ComponentEntry> = E extends readonly [infer C extends EntityId, unknown] ? C : E;

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
    if (data !== undefined && writeComponentColumns(meta.archetype, meta.row, componentId, data, world.revision)) {
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

  const dataWritten =
    data !== undefined && writeComponentColumns(meta.archetype, meta.row, componentId, data, world.revision);

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
 * Adds multiple components to an entity in one call, faster than adding them
 * one by one.
 *
 * Idempotent per entry: components the entity already has -- including
 * duplicates within the batch -- are skipped and keep their existing data.
 * Observer events fire in entry order, and callbacks may see entries from
 * later in the batch already applied.
 *
 * Acts as an assertion: after the call the entity is narrowed for every entry,
 * making the typed accessors like {@link getComponentValue} return
 * non-optional values.
 *
 * @throws {IrisEntityNotFound} If the entity or a component in the entries is not alive
 * @throws {IrisInvalidPair} If a pair entry contains a wildcard
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
  const meta = ensureEntity(world, entityId);
  const fromArchetype = meta.archetype;

  // Fold every non-pair entry into one transition
  let toArchetype = fromArchetype;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const componentId = typeof entry === "number" ? entry : entry[0];

    if (isPair(componentId)) {
      continue;
    }

    const { schema } = ensureEntity(world, componentId);
    toArchetype = archetypeTraverseAdd(world, toArchetype, componentId, schema);
  }

  if (toArchetype !== fromArchetype) {
    moveEntityToArchetype(world, meta, toArchetype);
  }

  // Replay the fold over its now-cached edges to tell which entries applied:
  // one that does not advance the cursor was already present or a duplicate
  let cursor = fromArchetype;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const componentId = typeof entry === "number" ? entry : entry[0];

    if (isPair(componentId)) {
      if (typeof entry === "number") {
        addComponent(world, entityId, entry as Pair<Relation<Record<string, never>>>);
      } else {
        addComponent(world, entityId, componentId, entry[1] as InferSchemaRecord<SchemaRecord>);
      }

      continue;
    }

    const next = archetypeTraverseAdd(world, cursor, componentId);

    if (next === cursor) {
      continue;
    }

    cursor = next;

    if (
      typeof entry !== "number" &&
      writeComponentColumns(meta.archetype, meta.row, componentId, entry[1], world.revision)
    ) {
      fireObserverEvent(world, "componentChanged", componentId, entityId);
    }

    fireObserverEvent(world, "componentAdded", componentId, entityId);
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
 * Removes multiple components from an entity in one call, faster than removing
 * them one by one.
 *
 * Idempotent per entry: components the entity lacks -- including duplicates
 * within the batch -- are skipped. Observer events fire in entry order, and
 * removal is observable through `removed()` events.
 *
 * @throws {IrisEntityNotFound} If the entity is not alive
 * @throws {IrisInvalidPair} If a pair entry contains a wildcard
 *
 * @example
 * ```typescript
 * removeComponents(world, entity, [Poisoned, Burning, pair(ChildOf, parent)]);
 * ```
 */
export function removeComponents(world: World, entityId: EntityId, componentIds: readonly EntityId[]): void {
  const meta = ensureEntity(world, entityId);
  const fromArchetype = meta.archetype;

  // Fold every non-pair removal into one transition
  let toArchetype = fromArchetype;

  for (let i = 0; i < componentIds.length; i++) {
    const componentId = componentIds[i]!;

    if (!isPair(componentId)) {
      toArchetype = archetypeTraverseRemove(world, toArchetype, componentId);
    }
  }

  if (toArchetype !== fromArchetype) {
    moveEntityToArchetype(world, meta, toArchetype);
  }

  // Replay the fold over its now-cached edges to tell which entries applied:
  // one that does not advance the cursor was already absent or a duplicate
  let cursor = fromArchetype;

  for (let i = 0; i < componentIds.length; i++) {
    const componentId = componentIds[i]!;

    if (isPair(componentId)) {
      removeComponent(world, entityId, componentId);

      continue;
    }

    const next = archetypeTraverseRemove(world, cursor, componentId);

    if (next !== cursor) {
      cursor = next;
      fireObserverEvent(world, "componentRemoved", componentId, entityId);
    }
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
 * Gets a complete data component or pair as a record snapshot.
 *
 * Returns undefined when the component is absent; narrow with
 * {@link hasComponent} first for a non-optional type. The record and its
 * vector fields are copies; reference fields retain their stored values.
 *
 * @throws {IrisEntityNotFound} If the entity is not alive
 *
 * @example
 * ```typescript
 * const position = getComponent(world, entity, Position);
 * ```
 */
export function getComponent<S extends SchemaRecord, N extends string>(
  world: World,
  entityId: EntityWith<Component<S, N>>,
  componentId: Component<S, N>
): InferSchemaRecord<S>;

export function getComponent<S extends SchemaRecord, N extends string, T>(
  world: World,
  entityId: EntityWith<Pair<Relation<S, N>, T>>,
  componentId: Pair<Relation<S, N>, T>
): InferSchemaRecord<S>;

export function getComponent<S extends SchemaRecord>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>
): InferSchemaRecord<S> | undefined;

export function getComponent<S extends SchemaRecord>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>
): InferSchemaRecord<S> | undefined {
  const { archetype, row } = ensureEntity(world, entityId);

  return readComponentColumns(archetype, row, componentId) as InferSchemaRecord<S> | undefined;
}

/**
 * Replaces a complete data component or pair record.
 *
 * No-op when the component is absent. Marks the component changed for
 * `changed()` query filters.
 *
 * @throws {IrisEntityNotFound} If the entity is not alive
 *
 * @example
 * ```typescript
 * setComponent(world, entity, Position, { x: 10.0, y: 20.0 });
 * ```
 */
export function setComponent<S extends SchemaRecord, N extends string>(
  world: World,
  entityId: EntityId,
  componentId: Component<S, N>,
  data: InferSchemaRecord<S>
): void;

export function setComponent<S extends SchemaRecord, N extends string, T>(
  world: World,
  entityId: EntityId,
  componentId: Pair<Relation<S, N>, T>,
  data: InferSchemaRecord<S>
): void;

export function setComponent<S extends SchemaRecord>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  data: InferSchemaRecord<S>
): void;

export function setComponent<S extends SchemaRecord>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  data: InferSchemaRecord<S>
): void {
  const { archetype, row } = ensureEntity(world, entityId);

  if (writeComponentColumns(archetype, row, componentId, data, world.revision)) {
    fireObserverEvent(world, "componentChanged", componentId, entityId);
  }
}

/**
 * Gets a field value from a data component or pair.
 *
 * Scalar values are returned directly and vector fields as tuple copies.
 * Returns undefined when the component is absent; narrow with
 * {@link hasComponent} first for a non-optional type.
 *
 * @throws {IrisEntityNotFound} If the entity is not alive
 *
 * @example
 * ```typescript
 * const x = getComponentValue(world, entity, Position, "x");
 * ```
 */
export function getComponentValue<S extends SchemaRecord, N extends string, K extends keyof S>(
  world: World,
  entityId: EntityWith<Component<S, N>>,
  componentId: Component<S, N>,
  fieldName: K
): InferSchema<S[K]>;

export function getComponentValue<S extends SchemaRecord, N extends string, T, K extends keyof S>(
  world: World,
  entityId: EntityWith<Pair<Relation<S, N>, T>>,
  componentId: Pair<Relation<S, N>, T>,
  fieldName: K
): InferSchema<S[K]>;

export function getComponentValue<S extends SchemaRecord, K extends keyof S>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  fieldName: K
): InferSchema<S[K]> | undefined;

export function getComponentValue<S extends SchemaRecord, K extends keyof S>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  fieldName: K
): InferSchema<S[K]> | undefined {
  const { archetype, row } = ensureEntity(world, entityId);

  return readField(archetype, componentId, fieldName as string, row) as InferSchema<S[K]> | undefined;
}

/**
 * Sets a field value on a data component or pair.
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
export function setComponentValue<S extends SchemaRecord, N extends string, K extends keyof S>(
  world: World,
  entityId: EntityWith<Component<S, N>>,
  componentId: Component<S, N>,
  fieldName: K,
  value: InferSchema<S[K]>
): void;

export function setComponentValue<S extends SchemaRecord, N extends string, T, K extends keyof S>(
  world: World,
  entityId: EntityWith<Pair<Relation<S, N>, T>>,
  componentId: Pair<Relation<S, N>, T>,
  fieldName: K,
  value: InferSchema<S[K]>
): void;

export function setComponentValue<S extends SchemaRecord, K extends keyof S>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  fieldName: K,
  value: InferSchema<S[K]>
): void;

export function setComponentValue<S extends SchemaRecord, K extends keyof S>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  fieldName: K,
  value: InferSchema<S[K]>
): void {
  const { archetype, row } = ensureEntity(world, entityId);

  if (writeField(archetype, componentId, fieldName as string, row, value, world.revision)) {
    fireObserverEvent(world, "componentChanged", componentId, entityId);
  }
}

/**
 * Marks a component as changed without writing a value.
 *
 * Feeds `changed()` query filters after out-of-band writes -- e.g. mutations
 * through {@link getComponentView}, which bypass change tracking.
 * No-op when the component is absent.
 *
 * @throws {IrisEntityNotFound} If the entity is not alive
 *
 * @example
 * ```typescript
 * const view = getComponentView(world, entity, Position, "value");
 * view[0] += 1.0;
 * markComponentChanged(world, entity, Position);
 * ```
 */
export function markComponentChanged(world: World, entityId: EntityId, componentId: EntityId): void {
  const { archetype, row } = ensureEntity(world, entityId);

  if (!archetype.typesSet.has(componentId)) {
    return;
  }

  stampComponentChanged(archetype, componentId, row, world.revision);
  fireObserverEvent(world, "componentChanged", componentId, entityId);
}

// ============================================================================
// Transition Internals
// ============================================================================

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

  stampComponentChanged(meta.archetype, encodePair(relation, Wildcard), meta.row, world.revision);
  stampComponentChanged(meta.archetype, encodePair(Wildcard, target), meta.row, world.revision);
}

// ============================================================================
// Component Views (Public API)
// ============================================================================

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
 * const Position = defineComponent("Position", { schema: { value: Type.f32(2) } });
 * const view = getComponentView(world, entity, Position, "value"); // Float32Array
 * view[0] += 1.0; // direct mutation, no copy
 * ```
 */
export function getComponentView<S extends SchemaRecord, N extends string, K extends VectorFields<S>>(
  world: World,
  entityId: EntityWith<Component<S, N>>,
  componentId: Component<S, N>,
  fieldName: K
): TypedArrayInstance;

export function getComponentView<S extends SchemaRecord, N extends string, T, K extends VectorFields<S>>(
  world: World,
  entityId: EntityWith<Pair<Relation<S, N>, T>>,
  componentId: Pair<Relation<S, N>, T>,
  fieldName: K
): TypedArrayInstance;

export function getComponentView<S extends SchemaRecord, K extends VectorFields<S>>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  fieldName: K
): TypedArrayInstance | undefined;

export function getComponentView<S extends SchemaRecord, K extends VectorFields<S>>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  fieldName: K
): TypedArrayInstance | undefined {
  const { archetype, row } = ensureEntity(world, entityId);

  return viewVectorField(archetype, componentId, fieldName as string, row);
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
