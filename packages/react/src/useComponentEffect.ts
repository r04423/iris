import type { Component, EntityId, Pair, Relation, SchemaRecord } from "iris-ecs";
import { registerObserverCallback, unregisterObserverCallback } from "iris-ecs";
import { useEffect, useRef } from "react";
import { useWorld } from "./context.js";

// ============================================================================
// useComponentEffect
// ============================================================================

/**
 * Registers a side-effect callback that fires when a component changes,
 * is added to, or is removed from the given entity.
 *
 * @param entityId - The entity to observe
 * @param componentId - The component (or pair) to watch
 * @param callback - Called on `componentChanged`, `componentAdded`, and `componentRemoved`
 *
 * @example
 * ```tsx
 * import { useComponentEffect } from "iris-react";
 *
 * function DamageFlash({ entity }: { entity: EntityWith<typeof Health> }) {
 *   const [flash, setFlash] = useState(false);
 *
 *   useComponentEffect(entity, Health, () => {
 *     setFlash(true);
 *     const timer = setTimeout(() => setFlash(false), 200);
 *     return () => clearTimeout(timer);
 *   });
 *
 *   return <div className={flash ? "flash" : ""} />;
 * }
 * ```
 */
export function useComponentEffect<S extends SchemaRecord>(
  entityId: EntityId,
  componentId: Component<S> | Pair<Relation<S>>,
  // biome-ignore lint/suspicious/noConfusingVoidType: matches React's EffectCallback pattern
  callback: () => void | (() => void)
): void {
  const world = useWorld();

  // Store callback in ref to avoid re-registering observers when callback
  // identity changes between renders.
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    // biome-ignore lint/suspicious/noConfusingVoidType: matches React's EffectCallback pattern
    let cleanup: void | (() => void);

    const notify = (changedComponentId: EntityId, changedEntityId: EntityId) => {
      if (changedComponentId === (componentId as EntityId) && changedEntityId === entityId) {
        if (typeof cleanup === "function") {
          cleanup();
        }

        cleanup = callbackRef.current();
      }
    };

    registerObserverCallback(world, "componentChanged", notify);
    registerObserverCallback(world, "componentAdded", notify);
    registerObserverCallback(world, "componentRemoved", notify);

    return () => {
      unregisterObserverCallback(world, "componentChanged", notify);
      unregisterObserverCallback(world, "componentAdded", notify);
      unregisterObserverCallback(world, "componentRemoved", notify);

      if (typeof cleanup === "function") {
        cleanup();
      }
    };
  }, [world, entityId, componentId]);
}
