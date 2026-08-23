import type { World } from "./world.js";

// ============================================================================
// Action Types
// ============================================================================

/**
 * Record of world-bound functions produced by an action initializer.
 *
 * The shape {@link defineActions} infers and preserves through its getter.
 */
export type Actions = Record<string, (...args: never[]) => unknown>;

/**
 * Factory that builds an actions record with the world captured in closure.
 *
 * Passed to {@link defineActions}; runs once per world, on first access.
 */
export type ActionInitializer<T extends Actions> = (world: World) => T;

/**
 * Getter returned by {@link defineActions}.
 *
 * Returns the world's cached actions record, running the initializer on first
 * access.
 */
export type ActionGetter<T extends Actions> = (world: World) => T;

// ============================================================================
// Action State
// ============================================================================

/**
 * Per-world cache of initialized action records, keyed by initializer identity.
 * @internal
 */
export type ActionState = {
  /** Actions lookup by initializer function. */
  byInitializer: Map<ActionInitializer<Actions>, Actions>;
};

/**
 * Creates an empty actions registry.
 * @internal
 */
export function createActionState(): ActionState {
  return {
    byInitializer: new Map(),
  };
}

/**
 * Clears the world's cached actions.
 * @internal
 */
export function resetActionState(world: World): void {
  world.actions.byInitializer.clear();
}

/**
 * Defines a reusable set of world-bound actions.
 *
 * The returned getter runs the initializer once per world and caches the
 * result: every later call with the same world returns the identical actions
 * object.
 *
 * `resetWorld` clears the cache, so initializers run again on next access.
 *
 * @example
 * ```typescript
 * const playerActions = defineActions((world) => ({
 *   spawn(x: number, y: number) {
 *     const entity = createEntity(world);
 *     addComponent(world, entity, Position, { x, y });
 *     return entity;
 *   },
 * }));
 *
 * const player = playerActions(world).spawn(100, 200);
 * ```
 */
export function defineActions<T extends Actions>(initializer: ActionInitializer<T>): ActionGetter<T> {
  return (world: World): T => {
    // Use the initializer function itself as a cache key for identity-based lookup
    let actions = world.actions.byInitializer.get(initializer) as T | undefined;

    if (actions === undefined) {
      actions = initializer(world);
      world.actions.byInitializer.set(initializer, actions);
    }

    return actions;
  };
}
