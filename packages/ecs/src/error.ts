// ============================================================================
// Base Error
// ============================================================================

/**
 * Base error class for all Iris ECS errors.
 *
 * Provides structured error categories with typed parameters for
 * programmatic error handling via `instanceof` checks.
 *
 * @example
 * ```typescript
 * try {
 *   createEntity(world);
 * } catch (error) {
 *   if (error instanceof LimitExceeded) {
 *     console.log(error.resource, error.max);
 *   }
 * }
 * ```
 */
export class IrisError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

// ============================================================================
// Error Categories
// ============================================================================

/**
 * Thrown when an ID space is exhausted.
 *
 * @example
 * ```typescript
 * // Thrown when entity limit (1,048,576) is exceeded
 * const entity = createEntity(world);
 * ```
 */
export class LimitExceeded extends IrisError {
  readonly resource: string;
  readonly max: number;
  readonly id?: number;

  constructor(params: { resource: string; max: number; id?: number }) {
    const idInfo = params.id !== undefined ? ` (cannot allocate ID ${params.id})` : "";
    super(`${params.resource} limit exceeded: max ${params.max}${idInfo}`);
    this.resource = params.resource;
    this.max = params.max;
    this.id = params.id;
  }
}

/**
 * Thrown when a referenced item does not exist.
 *
 * @example
 * ```typescript
 * // Thrown when accessing a destroyed entity
 * ensureEntity(world, destroyedEntity);
 * ```
 */
export class NotFound extends IrisError {
  readonly resource: string;
  readonly id: string | number;
  readonly context?: string;

  constructor(params: { resource: string; id: string | number; context?: string }) {
    const ctx = params.context ? ` in ${params.context}` : "";
    super(`${params.resource} "${params.id}" not found${ctx}`);
    this.resource = params.resource;
    this.id = params.id;
    this.context = params.context;
  }
}

/**
 * Thrown when attempting to register a duplicate item.
 *
 * @example
 * ```typescript
 * // Thrown when registering a system with the same name twice
 * addSystem(world, mySystem);
 * addSystem(world, mySystem); // throws Duplicate
 * ```
 */
export class Duplicate extends IrisError {
  readonly resource: string;
  readonly id: string | number;

  constructor(params: { resource: string; id: string | number }) {
    super(`${params.resource} "${params.id}" already exists`);
    this.resource = params.resource;
    this.id = params.id;
  }
}

/**
 * Thrown when a function argument fails validation.
 *
 * @example
 * ```typescript
 * // Thrown when registering an anonymous system without a name
 * addSystem(world, () => {});
 * ```
 */
export class InvalidArgument extends IrisError {
  readonly expected: string;
  readonly actual?: string;

  constructor(params: { expected: string; actual?: string }) {
    const act = params.actual !== undefined ? `, got ${params.actual}` : "";
    super(`Invalid argument: expected ${params.expected}${act}`);
    this.expected = params.expected;
    this.actual = params.actual;
  }
}

/**
 * Thrown when the system reaches an invalid or unexpected state.
 *
 * @example
 * ```typescript
 * // Thrown on circular system dependencies
 * addSystem(world, a, { before: "b" });
 * addSystem(world, b, { before: "a" });
 * await runOnce(world);
 * ```
 */
export class InvalidState extends IrisError {
  constructor(params: { message: string }) {
    super(params.message);
  }
}

// ============================================================================
// Assert Utility
// ============================================================================

/**
 * Assert a condition, throwing a typed error if false.
 *
 * Error is only constructed when the condition fails (lazy construction).
 * TypeScript `asserts condition` narrows the type at call sites.
 *
 * @param condition - Value to check for truthiness
 * @param ErrorClass - Error class to instantiate on failure
 * @param params - Constructor parameters for the error class
 *
 * @example
 * ```typescript
 * assert(rawId <= ID_MASK_20, LimitExceeded, { resource: "Entity", max: ID_MASK_20, id: rawId });
 * // rawId is narrowed to truthy after this point
 * ```
 */
export function assert<P>(condition: unknown, ErrorClass: new (params: P) => IrisError, params: P): asserts condition {
  if (!condition) {
    throw new ErrorClass(params);
  }
}
