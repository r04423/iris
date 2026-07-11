import type { EntityId, EntityWith } from "iris-ecs";
import {
  getName,
  hasComponent,
  isEntityAlive,
  lookupByName,
  Name,
  registerObserverCallback,
  unregisterObserverCallback,
} from "iris-ecs";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { useResetGeneration, useWorld } from "./context.js";

// ============================================================================
// useEntityByName
// ============================================================================

/**
 * Returns the entity with the given name, updating reactively when its name,
 * required components, or lifecycle changes.
 *
 * @param name - Unique entity name to look up
 * @param components - Optional components the entity must have
 * @returns The matching entity, or `undefined`
 *
 * @example
 * ```tsx
 * import { useEntityByName } from "iris-react";
 *
 * function PlayerHUD() {
 *   const player = useEntityByName("player", [Position, Health]);
 *   if (!player) return null;
 *   return <HealthBar entity={player} />;
 * }
 * ```
 */
export function useEntityByName(name: string): EntityId | undefined;
export function useEntityByName<C extends EntityId[]>(
  name: string,
  components: [...C]
): EntityWith<C[number]> | undefined;
export function useEntityByName(name: string, components: EntityId[] = []): EntityId | undefined {
  const world = useWorld();
  const generation = useResetGeneration();

  // Name observers may run before the registry is updated, so retain the
  // affected entity as a temporary lookup candidate.
  const latestNameEntityRef = useRef<EntityId | undefined>(undefined);

  // Inline component arrays are recreated on every render; their IDs form the
  // stable dependency identity used by the other query hooks.
  const componentsKey = components.join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: componentsKey encodes components identity
  const requiredIds = useMemo(() => new Set(components), [componentsKey]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const notifyComponent = (componentId: EntityId, entityId: EntityId) => {
        if (componentId === Name) {
          latestNameEntityRef.current = entityId;
        }

        // Only names and required-component membership can change the result.
        if (componentId === Name || requiredIds.has(componentId)) {
          onStoreChange();
        }
      };

      registerObserverCallback(world, "componentAdded", notifyComponent);
      registerObserverCallback(world, "componentRemoved", notifyComponent);
      registerObserverCallback(world, "componentChanged", notifyComponent);
      registerObserverCallback(world, "entityDestroyed", onStoreChange);

      return () => {
        unregisterObserverCallback(world, "componentAdded", notifyComponent);
        unregisterObserverCallback(world, "componentRemoved", notifyComponent);
        unregisterObserverCallback(world, "componentChanged", notifyComponent);
        unregisterObserverCallback(world, "entityDestroyed", onStoreChange);
      };
    },
    [world, requiredIds]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: componentsKey encodes components identity
  const getSnapshot = useCallback(() => {
    const indexed = lookupByName(world, name, components);

    // Validate the indexed entity because the registry can briefly contain the
    // previous mapping while a Name observer is being dispatched.
    if (indexed !== undefined && isEntityAlive(world, indexed) && getName(world, indexed) === name) {
      return indexed;
    }

    // During that brief window, read the changed entity directly. Once the
    // registry catches up, the indexed fast path above is used again.
    const candidate = latestNameEntityRef.current;

    if (candidate === undefined || !isEntityAlive(world, candidate) || getName(world, candidate) !== name) {
      return;
    }

    for (let i = 0; i < components.length; i++) {
      if (!hasComponent(world, candidate, components[i]!)) {
        return;
      }
    }

    return candidate;
  }, [world, name, componentsKey, generation]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
