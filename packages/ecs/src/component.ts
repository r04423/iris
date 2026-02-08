import { archetypeTraverseAdd, archetypeTraverseRemove, destroyArchetype } from "./archetype.js";
import type { Component, Entity, EntityId, Pair, Relation, Tag } from "./encoding.js";
import { encodePair, isPair } from "./encoding.js";
import { ensureEntity, moveEntityToArchetype } from "./entity.js";
import { fireObserverEvent } from "./observer.js";
import { Exclusive, Wildcard } from "./registry.js";
import { getPairRelation, getPairTarget, getRelationTargets } from "./relation.js";
import type { InferSchema, InferSchemaRecord, SchemaRecord } from "./schema.js";
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

  // Exclusive enforcement: remove old target before adding new
  if (isPair(componentId)) {
    const target = getPairTarget(world, componentId);
    const relation = getPairRelation(componentId);

    if (hasComponent(world, relation, Exclusive) && target !== Wildcard) {
      const oldTargets = getRelationTargets(world, entityId, relation);

      if (oldTargets.length > 0) {
        removeComponent(world, entityId, encodePair(relation, oldTargets[0]!));
      }
    }
  }

  const componentMeta = ensureEntity(world, componentId);
  const schema = componentMeta.schema;

  // Find target archetype
  let toArchetype = archetypeTraverseAdd(world, entityMeta.archetype, componentId, schema);

  // Add wildcard pairs for query patterns: pair(Wildcard, target) and pair(relation, Wildcard)
  if (isPair(componentId)) {
    const target = getPairTarget(world, componentId);
    const relation = getPairRelation(componentId);

    toArchetype = archetypeTraverseAdd(world, toArchetype, encodePair(Wildcard, target));
    toArchetype = archetypeTraverseAdd(world, toArchetype, encodePair(relation, Wildcard));
  }

  moveEntityToArchetype(world, entityMeta, toArchetype);

  if (data) {
    for (const fieldName in data) {
      const value = data[fieldName];
      setComponentValue(world, entityId, componentId as Component<S>, fieldName as keyof S, value);
    }
  }

  // Fire after move so observers can access component data
  fireObserverEvent(world, "componentAdded", componentId, entityId);
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

  // Find target archetype
  let toArchetype = archetypeTraverseRemove(world, meta.archetype, componentId);

  // Idempotent check
  if (toArchetype === meta.archetype) {
    return;
  }

  // Remove wildcard pairs only if no other pairs need them
  if (isPair(componentId)) {
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

  // Fire before move so observers can access component data
  fireObserverEvent(world, "componentRemoved", componentId, entityId);

  moveEntityToArchetype(world, meta, toArchetype);
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
export function hasComponent(world: World, entityId: EntityId, componentId: EntityId): boolean {
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
 * @returns Field value or undefined if component/field not present
 *
 * @example
 * ```typescript
 * const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });
 * const x = getComponentValue(world, entity, Position, 'x');
 * ```
 */
export function getComponentValue<S extends SchemaRecord, K extends keyof S>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  fieldName: K
): InferSchema<S[K]> | undefined {
  const meta = ensureEntity(world, entityId);

  const fieldColumns = meta.archetype.columns.get(componentId);
  if (!fieldColumns) {
    return;
  }

  const column = fieldColumns[fieldName as string];
  if (!column) {
    return;
  }

  return column[meta.row] as InferSchema<S[K]>;
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
export function setComponentValue<S extends SchemaRecord, K extends keyof S>(
  world: World,
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  fieldName: K,
  value: InferSchema<S[K]>
): void {
  const meta = ensureEntity(world, entityId);

  const fieldColumns = meta.archetype.columns.get(componentId);
  if (!fieldColumns) {
    return;
  }

  const column = fieldColumns[fieldName as string];
  if (!column) {
    return;
  }

  column[meta.row] = value;

  const ticks = meta.archetype.ticks.get(componentId);
  if (ticks) {
    ticks.changed[meta.row] = world.execution.tick;
  }

  fireObserverEvent(world, "componentChanged", componentId, entityId);
}

/**
 * Emit component changed event without setting a value.
 *
 * @param world - World instance
 * @param entityId - Entity with the component
 * @param componentId - Component that was changed
 *
 * @example
 * emitComponentChanged(world, entity, Position);  // Notify change tracking
 */
export function emitComponentChanged(world: World, entityId: EntityId, componentId: EntityId): void {
  const meta = ensureEntity(world, entityId);

  const ticks = meta.archetype.ticks.get(componentId);
  if (ticks) {
    ticks.changed[meta.row] = world.execution.tick;
  }

  fireObserverEvent(world, "componentChanged", componentId, entityId);
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
