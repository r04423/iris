import { assert, IrisInvalidArgument } from "./error.js";
import { type ConditionFactory, defineCondition } from "./scheduler.js";

// ============================================================================
// Built-in Conditions
// ============================================================================

/**
 * Create a condition that passes only on its first tick.
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
 * Create a condition that passes every number of world ticks.
 *
 * @param ticks - Positive safe integer interval
 * @returns Condition factory that passes when the world tick is divisible by ticks
 * @throws {IrisInvalidArgument} If ticks is not a positive safe integer
 *
 * @example
 * ```typescript
 * addSystem(world, updateAI, { condition: every(10) });
 * ```
 */
export function every(ticks: number): ConditionFactory {
  assert(Number.isSafeInteger(ticks) && ticks > 0, IrisInvalidArgument, {
    expected: "ticks to be a positive safe integer",
    actual: String(ticks),
  });

  return defineCondition(`every(${ticks})`, (world) => {
    return () => world.execution.tick > 0 && world.execution.tick % ticks === 0;
  });
}
