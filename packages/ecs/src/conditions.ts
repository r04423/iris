import { IrisInvalidInterval } from "./error.js";
import { defineComponent } from "./registry.js";
import { addResource, getResourceValue } from "./resource.js";
import { Type } from "./schema.js";
import type { World } from "./world.js";

// ============================================================================
// Condition Types
// ============================================================================

declare const CONDITION_BRAND: unique symbol;

/**
 * Named synchronous scheduler condition created by {@link defineCondition}.
 *
 * @example
 * ```typescript
 * const enabled = defineCondition("enabled", (world) => hasResource(world, Enabled));
 * ```
 */
export type Condition = {
  /** @internal Nominal brand for condition definitions. */
  readonly [CONDITION_BRAND]: true;
  /** Descriptive condition name. */
  readonly name: string;
  /** Checks whether attached systems may run. */
  readonly check: (world: World) => boolean;
};

// ============================================================================
// Built-in Condition State
// ============================================================================

const ConditionState = defineComponent("IrisConditionState", {
  schema: {
    counts: Type.ref<Map<Condition, number>>(),
  },
});

/** Lazy resource storage lets world reset discard counters without condition hooks. */
function ensureConditionCounts(world: World): Map<Condition, number> {
  let counts = getResourceValue(world, ConditionState, "counts");

  if (counts === undefined) {
    counts = new Map();
    addResource(world, ConditionState, { counts });
  }

  return counts;
}

// ============================================================================
// Condition Definition
// ============================================================================

/**
 * Defines a reusable synchronous scheduler condition.
 *
 * A definition is evaluated at most once per schedule invocation, with its
 * result shared by every system and set using that definition. Conditions run
 * outside system context, so event reads and change detection see nothing.
 *
 * @param name - Descriptive label; identity comes from the returned definition
 * @param check - Synchronous predicate evaluated outside system context
 * @returns Condition for the `condition` option of {@link addSystem} or `addSystemSet()`
 *
 * @example
 * ```typescript
 * const gameIsRunning = defineCondition("gameIsRunning", (world) => hasResource(world, GameState));
 * addSystem(world, movementSystem, { condition: gameIsRunning });
 * ```
 */
export function defineCondition(name: string, check: (world: World) => boolean): Condition {
  return { name, check } as Condition;
}

// ============================================================================
// Built-in Conditions
// ============================================================================

/**
 * Creates a condition that passes only on its first evaluation.
 *
 * Each call creates an independent definition. State belongs to the world and
 * starts over after `resetWorld()`.
 *
 * @returns Condition that passes once
 *
 * @example
 * ```typescript
 * addSystem(world, initializeRenderer, { condition: once() });
 * ```
 */
export function once(): Condition {
  const condition = defineCondition("once", (world) => {
    const counts = ensureConditionCounts(world);

    if (counts.has(condition)) {
      return false;
    }

    counts.set(condition, 1);

    return true;
  });

  return condition;
}

/**
 * Creates a condition that passes on every nth evaluation.
 *
 * Each call creates an independent definition. Reusing that definition shares
 * one evaluation per schedule invocation.
 *
 * @param ticks - Positive safe integer interval, counted in condition evaluations
 * @returns Condition that passes on every nth evaluation
 * @throws {IrisInvalidInterval} If ticks is not a positive safe integer
 *
 * @example
 * ```typescript
 * addSystem(world, updateAI, { condition: every(10) });
 * ```
 */
export function every(ticks: number): Condition {
  if (!Number.isSafeInteger(ticks) || ticks <= 0) {
    throw new IrisInvalidInterval(ticks);
  }

  const condition = defineCondition(`every(${ticks})`, (world) => {
    const counts = ensureConditionCounts(world);
    const count = ((counts.get(condition) ?? 0) + 1) % ticks;

    counts.set(condition, count);

    return count === 0;
  });

  return condition;
}
