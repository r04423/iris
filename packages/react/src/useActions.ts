import type { ActionGetter, Actions } from "iris-ecs";
import { useMemo } from "react";
import { useResetGeneration, useWorld } from "./context.js";

// ============================================================================
// useActions
// ============================================================================

/**
 * Returns the cached actions object for the current world.
 *
 * @param getter - Action getter returned by `defineActions()`
 * @returns The cached actions record
 *
 * @example
 * ```tsx
 * import { useActions } from "iris-react";
 * import { defineActions, createEntity, addComponent } from "iris-ecs";
 *
 * const spawnActions = defineActions((world) => ({
 *   spawnEnemy(x: number, y: number) {
 *     const e = createEntity(world);
 *     addComponent(world, e, [Position, { x, y }]);
 *     return e;
 *   },
 * }));
 *
 * function SpawnButton() {
 *   const { spawnEnemy } = useActions(spawnActions);
 *   return <button onClick={() => spawnEnemy(0, 0)}>Spawn</button>;
 * }
 * ```
 */
export function useActions<T extends Actions>(getter: ActionGetter<T>): T {
  const world = useWorld();
  const generation = useResetGeneration();

  // biome-ignore lint/correctness/useExhaustiveDependencies: generation invalidates memoized actions
  return useMemo(() => getter(world), [world, getter, generation]);
}
