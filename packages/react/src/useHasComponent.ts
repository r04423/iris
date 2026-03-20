import type { EntityId } from "iris-ecs";
import { hasComponent, isEntityAlive, registerObserverCallback, unregisterObserverCallback } from "iris-ecs";
import { useCallback, useSyncExternalStore } from "react";
import { useResetGeneration, useWorld } from "./context.js";

// ============================================================================
// useHasComponent
// ============================================================================

/**
 * Returns whether an entity has a given component, updating reactively
 * when the component is added to or removed from the entity.
 *
 * @param entityId - The entity to observe
 * @param componentId - The component, tag, or pair to check
 * @returns `true` if the entity has the component, `false` otherwise
 *
 * @example
 * ```tsx
 * import { useHasComponent } from "iris-react";
 *
 * function ShieldIndicator({ entity }: { entity: EntityId }) {
 *   const hasShield = useHasComponent(entity, Shield);
 *   if (!hasShield) return null;
 *   return <div className="shield-icon" />;
 * }
 * ```
 */
export function useHasComponent(entityId: EntityId, componentId: EntityId): boolean {
  const world = useWorld();
  const generation = useResetGeneration();

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const notify = (changedComponentId: EntityId, changedEntityId: EntityId) => {
        if (changedComponentId === componentId && changedEntityId === entityId) {
          onStoreChange();
        }
      };

      registerObserverCallback(world, "componentAdded", notify);
      registerObserverCallback(world, "componentRemoved", notify);

      return () => {
        unregisterObserverCallback(world, "componentAdded", notify);
        unregisterObserverCallback(world, "componentRemoved", notify);
      };
    },
    [world, entityId, componentId]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: generation invalidates memoized snapshot
  const getSnapshot = useCallback(() => {
    if (!isEntityAlive(world, entityId)) {
      return false;
    }

    return hasComponent(world, entityId, componentId);
  }, [world, entityId, componentId, generation]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
