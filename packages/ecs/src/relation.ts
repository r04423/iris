import { hasComponent } from "./component.js";
import type { EntityId, Pair, Relation, RelationTargetId } from "./encoding.js";
import {
  COMPONENT_TYPE,
  ENTITY_TYPE,
  encodeComponent,
  encodeEntity,
  encodePair,
  encodeRelation,
  encodeTag,
  extractId,
  extractPairRelationId,
  extractPairTargetId,
  extractPairTargetType,
  isPair,
  RELATIONSHIP_TYPE,
  TAG_TYPE,
} from "./encoding.js";
import { destroyEntity, ensureEntity, isEntityAlive } from "./entity.js";
import { OnDeleteTarget, Wildcard } from "./registry.js";
import type { World } from "./world.js";

// ============================================================================
// Pair Creation and Extraction
// ============================================================================

/**
 * Create a pair from a relation and target.
 *
 * @param relation - Relation ID
 * @param target - Target entity, tag, component, or relation
 * @returns Encoded pair ID that can be used as a component
 *
 * @example
 * const childOf = pair(ChildOf, parent);
 * addComponent(world, child, childOf);
 */
export function pair<R extends Relation>(relation: R, target: RelationTargetId): Pair<R> {
  return encodePair(relation, target);
}

/**
 * Extract the relation component from a pair.
 *
 * @param pairId - Encoded pair ID
 * @returns The relation ID
 *
 * @example
 * const rel = getPairRelation(pair(ChildOf, parent)); // ChildOf
 */
export function getPairRelation<R extends Relation>(pairId: Pair<R>): R {
  const relationRawId = extractPairRelationId(pairId);

  return encodeRelation(relationRawId) as R;
}

/**
 * Extract the target from a pair.
 *
 * For entity targets, looks up current generation for weak reference semantics.
 *
 * @param world - World instance
 * @param pairId - Encoded pair ID
 * @returns Target entity, tag, component, or relation
 *
 * @example
 * const target = getPairTarget(world, pair(ChildOf, parent)); // parent
 */
export function getPairTarget(world: World, pairId: Pair): RelationTargetId {
  const targetRawId = extractPairTargetId(pairId);
  const targetType = extractPairTargetType(pairId);

  switch (targetType) {
    case ENTITY_TYPE: {
      // Entity targets use weak reference semantics - look up current generation
      const generation = world.entities.generations.get(targetRawId)!;

      return encodeEntity(targetRawId, generation);
    }

    case TAG_TYPE: {
      return encodeTag(targetRawId);
    }

    case COMPONENT_TYPE: {
      return encodeComponent(targetRawId);
    }

    case RELATIONSHIP_TYPE: {
      return encodeRelation(targetRawId);
    }

    default:
      throw new Error(`Invalid target type in pair: ${targetType}`);
  }
}

// ============================================================================
// Relation Queries
// ============================================================================

/**
 * Get all targets for a relation on an entity.
 *
 * @param world - World instance
 * @param entityId - Entity to query
 * @param relation - Relation to find targets for
 * @returns Array of target IDs
 *
 * @example
 * const parents = getRelationTargets(world, child, ChildOf);
 */
export function getRelationTargets(world: World, entityId: EntityId, relation: Relation): RelationTargetId[] {
  const meta = ensureEntity(world, entityId);

  const relationRawId = extractId(relation);
  const relationWildcardPair = encodePair(relation, Wildcard);

  const targets: RelationTargetId[] = [];

  for (const typeId of meta.archetype.types) {
    if (!isPair(typeId)) {
      continue;
    }

    // Skip wildcard pair (pair(relation, Wildcard))
    if (typeId === relationWildcardPair) {
      continue;
    }

    const pairRelationRawId = extractPairRelationId(typeId);

    if (pairRelationRawId !== relationRawId) {
      continue;
    }

    targets.push(getPairTarget(world, typeId));
  }

  return targets;
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Clean up all pairs targeting a specific entity when it is destroyed.
 *
 * Handles OnDeleteTarget cascade policy by collecting and destroying subjects
 * that have pairs with the target entity.
 *
 * @param world - World instance
 * @param targetEntity - Entity being destroyed that may be a target
 */
export function cleanupPairsTargetingEntity(world: World, targetEntity: EntityId): void {
  // Pairs themselves cannot be targets of other pairs
  if (isPair(targetEntity)) {
    return;
  }

  // Use wildcard pair to find all archetypes containing pairs with this target
  const wildcardTargetPair = encodePair(Wildcard, targetEntity);

  if (!isEntityAlive(world, wildcardTargetPair)) {
    // Entity was never used as a target, nothing to clean up
    return;
  }

  const wildcardMeta = world.entities.byId.get(wildcardTargetPair)!;

  // Separate pairs by their OnDeleteTarget policy:
  // - pairsToRemove: Just destroy the pair entity (default behavior)
  // - pairsToDelete: Cascade delete to subjects holding the pair
  const pairsToRemove = new Set<EntityId>([wildcardTargetPair]);
  const pairsToDelete = new Set<EntityId>();

  for (const archetype of wildcardMeta.records) {
    for (const typeId of archetype.types) {
      if (typeId === wildcardTargetPair || !isPair(typeId) || getPairTarget(world, typeId) !== targetEntity) {
        continue;
      }

      const relation = getPairRelation(typeId);

      if (hasComponent(world, relation, OnDeleteTarget)) {
        pairsToDelete.add(typeId);
      } else {
        pairsToRemove.add(typeId);
      }
    }
  }

  // Phase 1: Collect subjects for cascade delete before destroying pairs
  // Using Set prevents duplicates when entity has multiple cascading pairs
  const subjectsToDelete = new Set<EntityId>();

  for (const pairId of pairsToDelete) {
    const pairMeta = world.entities.byId.get(pairId)!;

    for (const archetype of pairMeta.records) {
      for (const entityId of archetype.entities) {
        subjectsToDelete.add(entityId);
      }
    }
  }

  // Phase 2: Destroy non-cascading pair entities (removes pairs from subjects)
  for (const pairId of pairsToRemove) {
    destroyEntity(world, pairId);
  }

  // Phase 3: Destroy cascading pair entities
  for (const pairId of pairsToDelete) {
    destroyEntity(world, pairId);
  }

  // Phase 4: Delete subjects that had cascading pairs (may trigger recursive cascades)
  for (const entityId of subjectsToDelete) {
    destroyEntity(world, entityId);
  }
}
