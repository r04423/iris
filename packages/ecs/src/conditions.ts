import { IrisInvalidInterval } from "./error.js";
import type { World } from "./world.js";

// ============================================================================
// Condition Types
// ============================================================================

const CONDITION_FACTORY_BRAND: unique symbol = Symbol("ConditionFactory");

/**
 * Synchronous condition tick. Returning false skips the attached system or set.
 *
 * Conditions execute outside system context, so event reads and change
 * detection see nothing. Conditions may observe world state, but must not
 * mutate gameplay data or scheduler registrations.
 *
 * @example
 * ```typescript
 * const enabled = defineCondition("enabled", (world) =>
 *   () => hasResource(world, Enabled)
 * );
 * ```
 */
export type ConditionTick = () => boolean;

/**
 * Reusable condition factory with per-attachment initialization.
 *
 * @example
 * ```typescript
 * const everyOtherRun = defineCondition("everyOtherRun", () => {
 *   let run = false;
 *   return () => (run = !run);
 * });
 * addSystem(world, movementSystem, { condition: everyOtherRun });
 * ```
 */
export type ConditionFactory = {
  /** @internal Runtime brand for condition factories. */
  readonly [CONDITION_FACTORY_BRAND]: true;
  /** Descriptive condition name. */
  readonly name: string;
  /** Initializes a synchronous tick for one attachment. */
  readonly init: (world: World) => ConditionTick;
};

// ============================================================================
// Condition Definition
// ============================================================================

/**
 * Defines a reusable synchronous scheduler condition.
 *
 * The initializer runs independently for every system or set attachment before
 * scheduling begins and again after `resetWorld()`. It may observe world state,
 * but must not mutate it.
 *
 * @param init - Initializer returning the boolean condition tick
 * @returns Condition factory for the `condition` option of {@link addSystem} or `addSystemSet()`
 *
 * @example
 * ```typescript
 * const gameIsRunning = defineCondition("gameIsRunning", (world) =>
 *   () => hasResource(world, GameState)
 * );
 * addSystem(world, movementSystem, { condition: gameIsRunning });
 * ```
 */
export function defineCondition(name: string, init: (world: World) => ConditionTick): ConditionFactory {
  return { [CONDITION_FACTORY_BRAND]: true, name, init };
}

// ============================================================================
// Built-in Conditions
// ============================================================================

/**
 * Create a condition that passes only on its first evaluation.
 *
 * @returns Condition factory that passes once
 *
 * @example
 * ```typescript
 * addSystem(world, initializeRenderer, { condition: once() });
 * ```
 */
export function once(): ConditionFactory {
  return defineCondition("once", () => {
    let pending = true;

    return () => {
      const result = pending;
      pending = false;
      return result;
    };
  });
}

/**
 * Create a condition that passes on every nth evaluation.
 *
 * A system condition is evaluated once per frame, so `every(10)` passes every
 * tenth frame.
 *
 * @param ticks - Positive safe integer interval, counted in condition evaluations
 * @returns Condition factory that passes on every nth evaluation
 * @throws {IrisInvalidInterval} If ticks is not a positive safe integer
 *
 * @example
 * ```typescript
 * addSystem(world, updateAI, { condition: every(10) });
 * ```
 */
export function every(ticks: number): ConditionFactory {
  if (!Number.isSafeInteger(ticks) || ticks <= 0) {
    throw new IrisInvalidInterval(ticks);
  }

  return defineCondition(`every(${ticks})`, () => {
    let count = 0;

    return () => ++count % ticks === 0;
  });
}
