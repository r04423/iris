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
 * Create a condition that passes on every nth evaluation.
 *
 * A system condition is evaluated once per frame, so `every(10)` passes every
 * tenth frame.
 *
 * @param ticks - Positive safe integer interval, counted in condition evaluations
 * @returns Condition factory that passes on every nth evaluation
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

  return defineCondition(`every(${ticks})`, () => {
    let count = 0;

    return () => ++count % ticks === 0;
  });
}
