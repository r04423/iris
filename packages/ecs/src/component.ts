import { archetypeTraverseAdd, archetypeTraverseRemove, destroyArchetype, getColumnStride } from "./archetype.js";
import type { Component, Entity, EntityId, EntityWith, Pair, Relation, Tag } from "./encoding.js";
import { encodePair, isPair } from "./encoding.js";
import type { EntityMeta } from "./entity.js";
import { ensureEntity, moveEntityToArchetype } from "./entity.js";
import { fireObserverEvent } from "./observer.js";
import { Exclusive, Wildcard } from "./registry.js";
import { getPairRelation, getPairTarget, getRelationTargets } from "./relation.js";
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
  const entityMeta = ensureEntity(world, entityId);

  // Idempotent: already has component
  if (entityMeta.archetype.typesSet.has(componentId)) {
    return;
  }

  const componentIsPair = isPair(componentId);
  let removedPair: Pair | undefined;

  // Exclusive replacement is one transition so observers never see an intermediate state
  if (componentIsPair) {
    const target = getPairTarget(world, componentId);
    const relation = getPairRelation(componentId);

    if (hasComponent(world, relation, Exclusive) && target !== Wildcard) {
      const oldTargets = getRelationTargets(world, entityId, relation);

      if (oldTargets.length > 0) {
        removedPair = encodePair(relation, oldTargets[0]!);
      }
    }
  }

  const componentMeta = ensureEntity(world, componentId);
  const schema = componentMeta.schema;

  // Find target archetype
  let toArchetype = entityMeta.archetype;

  if (removedPair !== undefined) {
    const oldTarget = getPairTarget(world, removedPair);
    const oldTargetWildcardPair = encodePair(Wildcard, oldTarget);

    let hasOtherRelation = false;

    toArchetype = archetypeTraverseRemove(world, toArchetype, removedPair);

    for (let i = 0; i < entityMeta.archetype.types.length; i++) {
      const typeId = entityMeta.archetype.types[i]!;

      if (typeId === removedPair || typeId === oldTargetWildcardPair || !isPair(typeId)) {
        continue;
      }

      if (getPairTarget(world, typeId) === oldTarget) {
        hasOtherRelation = true;

        break;
      }
    }

    if (!hasOtherRelation) {
      toArchetype = archetypeTraverseRemove(world, toArchetype, oldTargetWildcardPair);
    }
  }

  toArchetype = archetypeTraverseAdd(world, toArchetype, componentId, schema);

  // Add wildcard pairs for query patterns: pair(Wildcard, target) and pair(relation, Wildcard)
  if (componentIsPair) {
    const target = getPairTarget(world, componentId);
    const relation = getPairRelation(componentId);

    toArchetype = archetypeTraverseAdd(world, toArchetype, encodePair(Wildcard, target));
    toArchetype = archetypeTraverseAdd(world, toArchetype, encodePair(relation, Wildcard));
  }

  moveEntityToArchetype(world, entityMeta, toArchetype);

  // Write initial field data inline to avoid repeated ensureEntity lookups
  // and support stride-aware writes for vector fields
  let dataChanged = false;

  if (data) {
    const fieldColumns = entityMeta.archetype.columns.get(componentId);

    if (fieldColumns) {
      for (const fieldName in data) {
        const value = data[fieldName];
        const column = fieldColumns[fieldName as string];

        if (!column) {
          continue;
        }

        const stride = getColumnStride(column, entityMeta.archetype.capacity);

        if (stride === 1) {
          column[entityMeta.row] = value;
        } else {
          const offset = entityMeta.row * stride;

          for (let i = 0; i < stride; i++) {
            column[offset + i] = (value as number[])[i]!;
          }
        }
      }

      const ticks = entityMeta.archetype.ticks.get(componentId);
      if (ticks) {
        ticks.changed[entityMeta.row] = world.revision;
      }

      dataChanged = true;
    }
  }

  if (componentIsPair) {
    markPairTopologyChanged(world, entityMeta, componentId);
  }

  if (removedPair !== undefined) {
    markPairTopologyChanged(world, entityMeta, removedPair);
    fireObserverEvent(world, "componentRemoved", removedPair, entityId);
  }

  if (dataChanged) {
    fireObserverEvent(world, "componentChanged", componentId, entityId);
  }

  // Fire after move so observers can access component data
  fireObserverEvent(world, "componentAdded", componentId, entityId);
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
 *
 * @example
 * ```typescript
 * addComponent(world, entity, tag);
 * removeComponent(world, entity, tag);
 * ```
 */
export function removeComponent(world: World, entityId: EntityId, componentId: EntityId): void {
  const meta = ensureEntity(world, entityId);
  const componentIsPair = isPair(componentId);

  // Find target archetype
  let toArchetype = archetypeTraverseRemove(world, meta.archetype, componentId);

  // Idempotent check
  if (toArchetype === meta.archetype) {
    return;
  }

  // Remove wildcard pairs only if no other pairs need them
  if (componentIsPair) {
    const target = getPairTarget(world, componentId);
    const relation = getPairRelation(componentId);

    const wildcardTargetPair = encodePair(Wildcard, target);
    const relationWildcardPair = encodePair(relation, Wildcard);

    let hasOtherTarget = false;
    let hasOtherRelation = false;

    for (const typeId of meta.archetype.types) {
      if (
        typeId === componentId ||
        typeId === wildcardTargetPair ||
        typeId === relationWildcardPair ||
        !isPair(typeId)
      ) {
        continue;
      }

      if (getPairTarget(world, typeId) === target) {
        hasOtherTarget = true;
      }

      if (getPairRelation(typeId) === relation) {
        hasOtherRelation = true;
      }
    }

    if (!hasOtherTarget) {
      toArchetype = archetypeTraverseRemove(world, toArchetype, wildcardTargetPair);
    }

    if (!hasOtherRelation) {
      toArchetype = archetypeTraverseRemove(world, toArchetype, relationWildcardPair);
    }
  }

  moveEntityToArchetype(world, meta, toArchetype);

  if (componentIsPair) {
    markPairTopologyChanged(world, meta, componentId);
  }

  // Fire after move so observers see the entity's new archetype
  fireObserverEvent(world, "componentRemoved", componentId, entityId);
}

/**
 * Check if entity has component.
 *
 * Returns false for dead entities or if component not present.
 *
 * @param world - World instance
 * @param entityId - Entity to check
 * @param componentId - Component to check
 * @returns True if entity has component
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

export function getComponentValue<S extends SchemaRecord, N extends string, K extends ScalarFields<S>>(
  world: World,
  entityId: EntityWith<Pair<Relation<S, N>>>,
  componentId: Pair<Relation<S, N>>,
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

  const fieldColumns = archetype.columns.get(componentId);
  if (!fieldColumns) {
    return;
  }

  const column = fieldColumns[fieldName as string];
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

export function setComponentValue<S extends SchemaRecord, N extends string, K extends ScalarFields<S>>(
  world: World,
  entityId: EntityWith<Pair<Relation<S, N>>>,
  componentId: Pair<Relation<S, N>>,
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

  const fieldColumns = archetype.columns.get(componentId);
  if (!fieldColumns) {
    return;
  }

  const column = fieldColumns[fieldName as string];
  if (!column) {
    return;
  }

  column[row] = value;

  const ticks = archetype.ticks.get(componentId);
  if (ticks) {
    ticks.changed[row] = world.revision;
  }

  fireObserverEvent(world, "componentChanged", componentId, entityId);
}

/**
 * Mark a component as changed without setting a value.
 *
 * @param world - World instance
 * @param entityId - Entity with the component
 * @param componentId - Component that was changed
 *
 * @example
 * markComponentChanged(world, entity, Position);  // Notify change tracking
 */
export function emitComponentChanged(world: World, entityId: EntityId, componentId: EntityId): void {
  const { archetype, row } = ensureEntity(world, entityId);

  const ticks = archetype.ticks.get(componentId);
  if (ticks) {
    ticks.changed[row] = world.revision;
  }

  fireObserverEvent(world, "componentChanged", componentId, entityId);
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

export function getComponentVectorValue<S extends SchemaRecord, N extends string, K extends VectorFields<S>>(
  world: World,
  entityId: EntityWith<Pair<Relation<S, N>>>,
  componentId: Pair<Relation<S, N>>,
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

  const fieldColumns = archetype.columns.get(componentId);
  if (!fieldColumns) return;

  const column = fieldColumns[fieldName as string];
  if (!column) return;

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

export function setComponentVectorValue<S extends SchemaRecord, N extends string, K extends VectorFields<S>>(
  world: World,
  entityId: EntityWith<Pair<Relation<S, N>>>,
  componentId: Pair<Relation<S, N>>,
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

  const fieldColumns = archetype.columns.get(componentId);
  if (!fieldColumns) return;

  const column = fieldColumns[fieldName as string];
  if (!column) return;

  const stride = getColumnStride(column, archetype.capacity);
  const offset = row * stride;

  for (let i = 0; i < stride; i++) {
    column[offset + i] = (value as number[])[i]!;
  }

  const ticks = archetype.ticks.get(componentId);
  if (ticks) {
    ticks.changed[row] = world.revision;
  }

  fireObserverEvent(world, "componentChanged", componentId, entityId);
}

/**
 * Get a zero-copy typed array view into a vector component field.
 *
 * Returns a `subarray` view that shares the underlying buffer. Mutations
 * to the view directly modify the stored data. **The view is invalidated
 * if the archetype resizes** (e.g., when new entities cause capacity growth).
 * Use within a system tick; do not cache across frames.
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

export function getComponentVectorView<S extends SchemaRecord, N extends string, K extends VectorFields<S>>(
  world: World,
  entityId: EntityWith<Pair<Relation<S, N>>>,
  componentId: Pair<Relation<S, N>>,
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

  const fieldColumns = archetype.columns.get(componentId);
  if (!fieldColumns) return;

  const column = fieldColumns[fieldName as string];
  if (!column || Array.isArray(column)) return;

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
  const meta = world.entities.byId.get(componentId)!;

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
