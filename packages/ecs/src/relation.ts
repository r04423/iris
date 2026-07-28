import { hasComponent } from "./component.js";
import type { EntityId, Pair, Relation } from "./encoding.js";
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
import { destroyEntity, ensureEntity, getEntityMeta, isEntityAlive } from "./entity.js";
import { IrisInvalidPair, IrisInvalidState } from "./error.js";
import { OnDeleteTarget, Wildcard } from "./registry.js";
import type { World } from "./world.js";

// ============================================================================
// Pair Creation and Extraction
// ============================================================================

/**
 * Creates a pair ID from a relation and a target.
 *
 * The result is usable anywhere a component ID is: {@link addComponent},
 * queries, value accessors. Deterministic -- the same relation and target
 * always produce the same value, so pairs compare with `===`.
 *
 * @throws {IrisInvalidPair} If the target is itself a pair
 *
 * @example
 * ```typescript
 * addComponent(world, child, pair(ChildOf, parent));
 * ```
 */
export function pair<R extends Relation, T extends EntityId>(
  relation: R,
  target: T & (T extends Pair ? never : unknown)
): Pair<R, T> {
  if (isPair(target)) {
    throw new IrisInvalidPair("entity, tag, component, or relation target", "pair");
  }

  return encodePair(relation, target);
}

/**
 * Extracts the relation from a pair.
 *
 * @example
 * ```typescript
 * getPairRelation(pair(ChildOf, parent)); // ChildOf
 * ```
 */
export function getPairRelation<R extends Relation>(pairId: Pair<R>): R {
  const relationRawId = extractPairRelationId(pairId);

  return encodeRelation(relationRawId) as R;
}

/**
 * Extracts the target from a pair.
 *
 * Entity targets resolve as weak references through the world: while the
 * target lives, the original entity comes back; after it is destroyed, the
 * result is a dead ID ({@link isEntityAlive} returns false); and once the ID
 * is recycled, the result is the new entity occupying it.
 *
 * @throws {IrisInvalidState} If the ID is not a well-formed pair
 *
 * @example
 * ```typescript
 * getPairTarget(world, pair(ChildOf, parent)); // parent
 * ```
 */
export function getPairTarget(world: World, pairId: Pair): EntityId {
  const targetRawId = extractPairTargetId(pairId);
  const targetType = extractPairTargetType(pairId);

  switch (targetType) {
    case ENTITY_TYPE: {
      // Entity targets use weak reference semantics - look up current generation
      return encodeEntity(targetRawId, world.entities.generations[targetRawId]!);
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
      throw new IrisInvalidState({ message: `Invalid target type in pair: ${targetType}` });
  }
}

// ============================================================================
// Relation Queries
// ============================================================================

/**
 * Gets all targets the entity holds for a relation.
 *
 * Only concrete targets are returned -- the wildcard aggregate is excluded.
 * For an exclusive relation the result has at most one element.
 *
 * @throws {IrisEntityNotFound} If the entity is not alive
 *
 * @example
 * ```typescript
 * const parents = getRelationTargets(world, child, ChildOf);
 * ```
 */
export function getRelationTargets(world: World, entityId: EntityId, relation: Relation): EntityId[] {
  const meta = ensureEntity(world, entityId);

  const relationRawId = extractId(relation);
  const relationWildcardPair = encodePair(relation, Wildcard);

  const targets: EntityId[] = [];

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
 * Removes every pair targeting a destroyed entity from its subjects and, for
 * relations with the `onDeleteTarget: "delete"` policy, destroys the subjects
 * themselves.
 * @internal
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

  const wildcardMeta = getEntityMeta(world, wildcardTargetPair)!;

  // Separate pairs by their OnDeleteTarget policy:
  // - pairsToRemove: Just destroy the pair entity (default behavior)
  // - pairsToDelete: Cascade delete to subjects holding the pair
  const pairsToRemove = new Set<EntityId>();
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
    const pairMeta = getEntityMeta(world, pairId)!;

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

  // Phase 4: Destroy the target aggregate last - the concrete pair removals above
  // already dropped it from every subject, so no entity still holds it
  destroyEntity(world, wildcardTargetPair);

  // Phase 5: Delete subjects that had cascading pairs (may trigger recursive cascades)
  for (const entityId of subjectsToDelete) {
    destroyEntity(world, entityId);
  }
}

/**
 * Removes every pair of a destroyed relation from its subjects.
 *
 * Mirror of {@link cleanupPairsTargetingEntity} for the relation side.
 * `onDeleteTarget` describes target deletion only, so subjects are always kept.
 * @internal
 */
export function cleanupPairsUsingRelation(world: World, relation: Relation): void {
  // Use wildcard pair to find all archetypes containing pairs with this relation
  const relationWildcardPair = encodePair(relation, Wildcard);

  if (!isEntityAlive(world, relationWildcardPair)) {
    // Relation was never used in a pair, nothing to clean up
    return;
  }

  const wildcardMeta = getEntityMeta(world, relationWildcardPair)!;
  const relationRawId = extractId(relation);

  const pairsToRemove = new Set<EntityId>();

  for (const archetype of wildcardMeta.records) {
    for (const typeId of archetype.types) {
      if (typeId === relationWildcardPair || !isPair(typeId) || extractPairRelationId(typeId) !== relationRawId) {
        continue;
      }

      pairsToRemove.add(typeId);
    }
  }

  for (const pairId of pairsToRemove) {
    destroyEntity(world, pairId);
  }

  // Destroy the relation aggregate last - the concrete pair removals should've already
  // dropped it from every subject, so no entity still holds it
  destroyEntity(world, relationWildcardPair);
}
