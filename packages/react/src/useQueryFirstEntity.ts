import type { EntityId, EntityWith, ExtractIncluded, QueryModifier } from "iris-ecs";
import { useQueryEntities } from "./useQueryEntities.js";

// ============================================================================
// useQueryFirstEntity
// ============================================================================

/**
 * Returns the first entity matching the given query terms, or `undefined`
 * if no entities match. Thin wrapper around {@link useQueryEntities}.
 *
 * @param terms - Component IDs and query modifiers
 * @returns The first matching entity, or `undefined`
 *
 * @example
 * ```tsx
 * import { useQueryFirstEntity } from "iris-react";
 *
 * function PlayerHUD() {
 *   const player = useQueryFirstEntity(Player, Health);
 *   if (!player) return null;
 *   return <HealthBar entity={player} />;
 * }
 * ```
 */
export function useQueryFirstEntity<T extends (EntityId | QueryModifier)[]>(
  ...terms: [...T]
): EntityWith<ExtractIncluded<T>> | undefined {
  return useQueryEntities(...terms).at(0);
}
