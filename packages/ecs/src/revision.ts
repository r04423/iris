import { IrisRevisionOverflow } from "./error.js";
import type { World } from "./world.js";

// ============================================================================
// Revision State
// ============================================================================

/**
 * Initial clock value. Starts at 1 so a zero cursor observes every stamp.
 * @internal
 */
export function createRevision(): number {
  return 1;
}

/**
 * Resets the clock; cursors live on query and event metadata and reset with them.
 * @internal
 */
export function resetRevision(world: World): void {
  world.revision = createRevision();
}

// ============================================================================
// Revision Windows
// ============================================================================

/**
 * Consumes one observation window against the world's revision clock: records
 * `boundary` as the system's cursor, then advances the clock so writes made
 * after the read fall outside the window. Returns the previous cursor.
 * @internal
 */
export function consumeRevisionWindow(
  world: World,
  cursors: Map<string, number>,
  systemId: string,
  boundary: number
): number {
  const previous = cursors.get(systemId) ?? 0;

  if (boundary >= Number.MAX_SAFE_INTEGER) {
    throw new IrisRevisionOverflow();
  }

  cursors.set(systemId, boundary);
  world.revision = boundary + 1;

  return previous;
}

/**
 * Whether a revision stamp falls inside the (lastRevision, boundary] window.
 * @internal
 */
export function inRevisionWindow(revision: number, lastRevision: number, boundary: number): boolean {
  return revision > lastRevision && revision <= boundary;
}
