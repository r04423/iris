import type {
  Component,
  EntityId,
  EntityWith,
  InferSchema,
  Pair,
  Relation,
  ScalarFields,
  SchemaRecord,
} from "iris-ecs";
import { getComponentValue, isEntityAlive, registerObserverCallback, unregisterObserverCallback } from "iris-ecs";
import { useCallback, useSyncExternalStore } from "react";
import { useResetGeneration, useWorld } from "./context.js";

// ============================================================================
// useComponentValue
// ============================================================================

/**
 * Returns a single component field value, updating reactively when the
 * component changes on the given entity.
 *
 * @param entityId - The entity to observe
 * @param componentId - The component (or pair) to read from
 * @param fieldName - The schema field to return
 * @returns The field value, or `undefined` if the component is absent
 *
 * @example
 * ```tsx
 * import { useComponentValue } from "iris-react";
 *
 * function HealthBar({ entity }: { entity: EntityWith<typeof Health> }) {
 *   const hp = useComponentValue(entity, Health, "current");
 *   const max = useComponentValue(entity, Health, "max");
 *   return <div style={{ width: `${((hp ?? 0) / (max ?? 1)) * 100}%` }} />;
 * }
 * ```
 */
export function useComponentValue<S extends SchemaRecord, N extends string, K extends ScalarFields<S>>(
  entityId: EntityWith<Component<S, N>>,
  componentId: Component<S, N>,
  fieldName: K
): InferSchema<S[K]>;
export function useComponentValue<S extends SchemaRecord, N extends string, K extends ScalarFields<S>>(
  entityId: EntityWith<Pair<Relation<S, N>>>,
  componentId: Pair<Relation<S, N>>,
  fieldName: K
): InferSchema<S[K]>;
export function useComponentValue<S extends SchemaRecord, K extends ScalarFields<S>>(
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  fieldName: K
): InferSchema<S[K]> | undefined;
export function useComponentValue<S extends SchemaRecord, K extends ScalarFields<S>>(
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  fieldName: K
): InferSchema<S[K]> | undefined {
  const world = useWorld();
  const generation = useResetGeneration();

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const notify = (changedComponentId: EntityId, changedEntityId: EntityId) => {
        if (changedComponentId === (componentId as EntityId) && changedEntityId === entityId) {
          onStoreChange();
        }
      };

      registerObserverCallback(world, "componentChanged", notify);
      registerObserverCallback(world, "componentAdded", notify);
      registerObserverCallback(world, "componentRemoved", notify);

      return () => {
        unregisterObserverCallback(world, "componentChanged", notify);
        unregisterObserverCallback(world, "componentAdded", notify);
        unregisterObserverCallback(world, "componentRemoved", notify);
      };
    },
    [world, entityId, componentId]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: generation invalidates memoized snapshot
  const getSnapshot = useCallback(() => {
    if (!isEntityAlive(world, entityId)) {
      return undefined;
    }

    return getComponentValue(world, entityId, componentId, fieldName);
  }, [world, entityId, componentId, fieldName, generation]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
