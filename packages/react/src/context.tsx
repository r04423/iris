import type { World } from "iris-ecs";
import { assert, IrisInvalidState, registerObserverCallback, unregisterObserverCallback } from "iris-ecs";
import { createContext, useContext, useEffect, useState } from "react";

// ============================================================================
// Contexts
// ============================================================================

const WorldContext = createContext<World | null>(null);
const ResetGenerationContext = createContext<number>(0);

// ============================================================================
// WorldProvider
// ============================================================================

/**
 * Provides an Iris ECS world to the React component tree.
 *
 * Registers a `worldReset` observer that increments an internal generation
 * counter, allowing descendant hooks to invalidate memoized ECS state
 * (cached queries, dirty flags) when `resetWorld()` is called.
 *
 * @example
 * ```tsx
 * import { WorldProvider } from "iris-react";
 * import { createWorld } from "iris-ecs";
 *
 * const world = createWorld();
 *
 * function App() {
 *   return (
 *     <WorldProvider world={world}>
 *       <Game />
 *     </WorldProvider>
 *   );
 * }
 * ```
 */
export function WorldProvider(props: { world: World; children: React.ReactNode }): React.JSX.Element {
  const { world, children } = props;
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const onReset = () => {
      setGeneration((g) => g + 1);
    };

    registerObserverCallback(world, "worldReset", onReset);

    return () => {
      unregisterObserverCallback(world, "worldReset", onReset);
    };
  }, [world]);

  return (
    <WorldContext.Provider value={world}>
      <ResetGenerationContext.Provider value={generation}>{children}</ResetGenerationContext.Provider>
    </WorldContext.Provider>
  );
}

// ============================================================================
// useWorld
// ============================================================================

/**
 * Returns the Iris ECS world from the nearest `WorldProvider`.
 *
 * @returns The world instance
 * @throws {IrisInvalidState} If called outside a `WorldProvider`
 *
 * @example
 * ```tsx
 * import { useWorld } from "iris-react";
 *
 * function EntityCount() {
 *   const world = useWorld();
 *   return <span>{world.entities.byId.size}</span>;
 * }
 * ```
 */
export function useWorld(): World {
  const world = useContext(WorldContext);

  assert(world !== null, IrisInvalidState, { message: "useWorld must be used within a WorldProvider" });

  return world;
}

// ============================================================================
// Reset Generation
// ============================================================================

/**
 * Returns the current reset generation counter.
 *
 * Incremented each time `resetWorld()` is called on the provided world.
 * Used by reactive hooks (`useEntities`, `useComponentValue`) to invalidate
 * memoized ECS state after a world reset.
 *
 * @internal
 */
export function useResetGeneration(): number {
  return useContext(ResetGenerationContext);
}
