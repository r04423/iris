import type { EntityId, EntityWith, QueryTerm } from "iris-ecs";
import { collectEntities, registerObserverCallback, unregisterObserverCallback } from "iris-ecs";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { useResetGeneration, useWorld } from "./context.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Query terms supported by reactive hooks.
 * @internal
 */
export type ReactiveQueryTerm = EntityId | Extract<QueryTerm, { type: "not" }>;

/**
 * Components guaranteed present by reactive query terms.
 * @internal
 */
export type ExtractIncluded<T extends readonly ReactiveQueryTerm[]> = T extends readonly [
  infer Head,
  ...infer Tail extends ReactiveQueryTerm[],
]
  ? Head extends EntityId
    ? Head | ExtractIncluded<Tail>
    : ExtractIncluded<Tail>
  : never;

/**
 * Produce a stable string key from query terms for use as a `useMemo`
 * dependency
 *
 * @internal
 */
function termsToKey(terms: readonly ReactiveQueryTerm[]): string {
  let key = "";

  for (let i = 0; i < terms.length; i++) {
    if (i > 0) {
      key += ",";
    }

    const term = terms[i]!;

    if (typeof term === "number") {
      key += term;
    } else {
      key += term.type[0]! + term.componentId;
    }
  }

  return key;
}

// ============================================================================
// useQueryEntities
// ============================================================================

/**
 * Returns a reactive array of entities matching the given query terms.
 *
 * Updates when entities enter or leave the query due to component additions,
 * removals, or entity destruction.
 *
 * @param terms - Component IDs and query modifiers
 * @returns Array of entity IDs matching the query, with branded type narrowing
 *
 * @example
 * ```tsx
 * import { useQueryEntities } from "iris-react";
 * import { not } from "iris-ecs";
 *
 * function EnemyList() {
 *   const enemies = useQueryEntities(Enemy, Position, not(Dead));
 *   return <ul>{enemies.map(id => <EnemyRow key={id} entity={id} />)}</ul>;
 * }
 * ```
 */
export function useQueryEntities<T extends ReactiveQueryTerm[]>(...terms: T): EntityWith<ExtractIncluded<T>>[] {
  type Result = EntityWith<ExtractIncluded<T>>;

  const world = useWorld();
  const generation = useResetGeneration();
  const dirtyRef = useRef(true);
  const cachedRef = useRef<Result[]>([]);

  const termKey = termsToKey(terms);

  // biome-ignore lint/correctness/useExhaustiveDependencies: termKey encodes terms identity
  const stableTerms = useMemo(() => {
    dirtyRef.current = true;

    return terms;
  }, [world, generation, termKey]);

  const relevantIds = useMemo(() => {
    const set = new Set<EntityId>();

    for (let i = 0; i < stableTerms.length; i++) {
      const term = stableTerms[i]!;

      set.add(typeof term === "number" ? term : term.componentId);
    }

    return set;
  }, [stableTerms]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const notifyComponent = (componentId: EntityId, _entityId: EntityId) => {
        if (relevantIds.has(componentId)) {
          dirtyRef.current = true;
          onStoreChange();
        }
      };

      const notifyDestroyed = (_entityId: EntityId) => {
        dirtyRef.current = true;
        onStoreChange();
      };

      registerObserverCallback(world, "componentAdded", notifyComponent);
      registerObserverCallback(world, "componentRemoved", notifyComponent);
      registerObserverCallback(world, "entityDestroyed", notifyDestroyed);

      return () => {
        unregisterObserverCallback(world, "componentAdded", notifyComponent);
        unregisterObserverCallback(world, "componentRemoved", notifyComponent);
        unregisterObserverCallback(world, "entityDestroyed", notifyDestroyed);
      };
    },
    [world, relevantIds]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: generation invalidates memoized snapshot
  const getSnapshot = useCallback(() => {
    if (!dirtyRef.current) {
      return cachedRef.current;
    }

    dirtyRef.current = false;

    const fresh = collectEntities(world, stableTerms) as Result[];
    const cached = cachedRef.current;

    if (fresh.length === cached.length) {
      let same = true;

      for (let i = 0; i < fresh.length; i++) {
        if (fresh[i] !== cached[i]) {
          same = false;
          break;
        }
      }

      if (same) {
        return cached;
      }
    }

    cachedRef.current = fresh;

    return fresh;
  }, [world, stableTerms, generation]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
