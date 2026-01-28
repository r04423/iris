import type { World } from "./world.js";

// ============================================================================
// Action Types
// ============================================================================

/**
 * Actions record type.
 *
 * A record of functions that can be bound to a world via closure.
 */
export type Actions = Record<string, (...args: never[]) => unknown>;

/**
 * Action initializer function.
 *
 * Takes a world and returns an actions record with world captured in closure.
 */
export type ActionInitializer<T extends Actions> = (world: World) => T;

/**
 * Action getter function.
 *
 * Takes a world and returns cached actions (creating on first access).
 */
export type ActionGetter<T extends Actions> = (world: World) => T;

/**
 * Define reusable actions bound to a world via closure. Actions are initialized
 * once per world and cached for subsequent access.
 *
 * @param initializer - Function that creates actions with world captured in closure
 * @returns Getter function that returns cached actions for a world
 *
 * @example
 * ```typescript
 * const transformActions = defineActions((world) => ({
 *   spawn(x: number, y: number): Entity {
 *     const entity = createEntity(world);
 *     addComponent(world, entity, Position, { x, y });
 *     return entity;
 *   },
 * }));
 *
 * // In systems - getter returns cached actions for the world
 * const transform = transformActions(world);
 * const player = transform.spawn(100, 200);
 * ```
 */
export function defineActions<T extends Actions>(initializer: ActionInitializer<T>): ActionGetter<T> {
  return (world: World): T => {
    // Use the initializer function itself as a cache key for identity-based lookup
    let actions = world.actions.byInitializer.get(initializer) as T | undefined;

    if (actions === undefined) {
      // First access for this world - initialize and cache
      actions = initializer(world);
      world.actions.byInitializer.set(initializer, actions);
    }

    return actions;
  };
}
