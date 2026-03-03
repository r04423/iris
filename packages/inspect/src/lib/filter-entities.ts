import { extractId, isPair } from "iris-ecs";
import type { EntitySnapshot } from "../types.js";

// ============================================================================
// Entity Filtering
// ============================================================================

/**
 * Filters entity snapshots by search query.
 *
 * - Empty query returns all entities.
 * - Numeric queries match entity ID prefix (e.g. "12" matches #12, #120, #1234).
 * - Non-numeric queries match entity name (case-insensitive substring).
 *
 * @internal
 */
export function filterEntities(entities: EntitySnapshot[], query: string): EntitySnapshot[] {
  const trimmed = query.trim();
  if (trimmed === "") return entities;

  const isNumeric = /^\d+$/.test(trimmed);

  if (isNumeric) {
    return entities.filter((e) => {
      const rawId = isPair(e.id) ? 0 : extractId(e.id);
      return String(rawId).startsWith(trimmed);
    });
  }

  const lower = trimmed.toLowerCase();
  return entities.filter((e) => e.name?.toLowerCase().includes(lower));
}
