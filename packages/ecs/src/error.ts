import { ID_MASK_8, ID_MASK_20 } from "./encoding.js";

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
 *   if (error instanceof IrisLimitExceeded) {
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
 * Thrown when an ID space or another finite library counter is exhausted.
 *
 * @example
 * ```typescript
 * try {
 *   const entity = createEntity(world);
 * } catch (error) {
 *   if (error instanceof IrisLimitExceeded) {
 *     console.log(error.resource, error.max);
 *   }
 * }
 * ```
 */
export class IrisLimitExceeded extends IrisError {
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
 * try {
 *   addComponent(world, staleEntity, Player);
 * } catch (error) {
 *   if (error instanceof IrisNotFound) {
 *     console.log(error.resource, error.id); // "Entity", 42
 *   }
 * }
 * ```
 */
export class IrisNotFound extends IrisError {
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
 * addSystem(world, mySystem); // throws IrisDuplicate
 * ```
 */
export class IrisDuplicate extends IrisError {
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
 * defineSystem("", () => {}); // throws IrisInvalidArgument
 * ```
 */
export class IrisInvalidArgument extends IrisError {
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
 * addSystem(world, a, { before: [b] });
 * addSystem(world, b, { before: [a] });
 * await runOnce(world);
 * ```
 */
export class IrisInvalidState extends IrisError {
  constructor(params: { message: string }) {
    super(params.message);
  }
}

// ============================================================================
// Entity Errors
// ============================================================================

/**
 * Thrown when the entity ID space (1,048,575 IDs) is exhausted.
 *
 * @example
 * ```typescript
 * try {
 *   createEntity(world);
 * } catch (error) {
 *   if (error instanceof IrisEntityLimitExceeded) {
 *     console.log(error.max);
 *   }
 * }
 * ```
 */
export class IrisEntityLimitExceeded extends IrisLimitExceeded {
  constructor(id: number) {
    super({ resource: "Entity", max: ID_MASK_20, id });
  }
}

/**
 * Thrown when an entity is not alive in the world (never created or destroyed).
 *
 * @example
 * ```typescript
 * try {
 *   getComponentValue(world, destroyedEntity, Position, "x");
 * } catch (error) {
 *   if (error instanceof IrisEntityNotFound) {
 *     console.log(error.id);
 *   }
 * }
 * ```
 */
export class IrisEntityNotFound extends IrisNotFound {
  constructor(id: number) {
    super({ resource: "Entity", id, context: "world" });
  }
}

// ============================================================================
// Definition Errors
// ============================================================================

/**
 * Thrown when defining a tag, component, or relation with a name already in use.
 *
 * @example
 * ```typescript
 * defineComponent("Player");
 * defineComponent("Player"); // throws IrisDuplicateDefinition
 * ```
 */
export class IrisDuplicateDefinition extends IrisDuplicate {
  constructor(name: string) {
    super({ resource: "Definition", id: name });
  }
}

/**
 * Thrown when the ID space for tags (1,048,575), components (1,048,575),
 * or relations (255) is exhausted.
 *
 * @example
 * ```typescript
 * const Player = defineComponent("Player"); // throws when tag IDs run out
 * ```
 */
export class IrisDefinitionLimitExceeded extends IrisLimitExceeded {
  constructor(kind: "Tag" | "Component" | "Relation") {
    super({ resource: kind, max: kind === "Relation" ? ID_MASK_8 : ID_MASK_20 });
  }
}

// ============================================================================
// Name Errors
// ============================================================================

/**
 * Thrown when assigning an empty name to an entity.
 *
 * @example
 * ```typescript
 * setName(world, entity, ""); // throws IrisInvalidName
 * ```
 */
export class IrisInvalidName extends IrisInvalidArgument {
  constructor() {
    super({ expected: "non-empty name" });
  }
}

/**
 * Thrown when assigning a name that another entity already holds.
 *
 * @example
 * ```typescript
 * setName(world, a, "player-1");
 * setName(world, b, "player-1"); // throws IrisDuplicateName
 * ```
 */
export class IrisDuplicateName extends IrisDuplicate {
  constructor(name: string) {
    super({ resource: "Name", id: name });
  }
}

// ============================================================================
// Scheduler Errors
// ============================================================================

/**
 * Thrown when registering a system under a name already used by a system or set.
 *
 * @example
 * ```typescript
 * addSystem(world, physicsSystem);
 * addSystem(world, physicsSystem); // throws IrisDuplicateSystem
 * ```
 */
export class IrisDuplicateSystem extends IrisDuplicate {
  constructor(name: string) {
    super({ resource: "System", id: name });
  }
}

/**
 * Thrown when registering a system set under a name already used by a set or system.
 *
 * @example
 * ```typescript
 * addSystemSet(world, "render");
 * addSystemSet(world, "render"); // throws IrisDuplicateSystemSet
 * ```
 */
export class IrisDuplicateSystemSet extends IrisDuplicate {
  constructor(name: string) {
    super({ resource: "SystemSet", id: name });
  }
}

/**
 * Thrown when defining or registering a system with an empty name.
 */
export class IrisInvalidSystemName extends IrisInvalidArgument {
  constructor() {
    super({ expected: "non-empty system name" });
  }
}

/**
 * Thrown when a system references a system set that is not registered.
 *
 * @example
 * ```typescript
 * addSystem(world, mySystem, { set: "missing" }); // throws IrisSystemSetNotFound
 * ```
 */
export class IrisSystemSetNotFound extends IrisNotFound {
  constructor(name: string, context: string) {
    super({ resource: "SystemSet", id: name, context });
  }
}

/**
 * Thrown when a `before`/`after` constraint references an unknown system or set.
 *
 * @example
 * ```typescript
 * addSystem(world, mySystem, { before: ["missing"] });
 * await runOnce(world); // throws IrisSystemNotFound
 * ```
 */
export class IrisSystemNotFound extends IrisNotFound {
  constructor(name: string, context: string) {
    super({ resource: "System or SystemSet", id: name, context });
  }
}

/**
 * Thrown when a referenced schedule is not part of the pipeline.
 *
 * @example
 * ```typescript
 * addSystem(world, mySystem, { schedule: unknownSchedule });
 * await runOnce(world); // throws IrisScheduleNotFound
 * ```
 */
export class IrisScheduleNotFound extends IrisNotFound {
  constructor(label: string, context: string) {
    super({ resource: "Schedule", id: label, context });
  }
}

/**
 * Thrown when inserting a schedule that is already in the pipeline.
 *
 * @example
 * ```typescript
 * insertScheduleAfter(world, Update, Update); // throws IrisDuplicateSchedule
 * ```
 */
export class IrisDuplicateSchedule extends IrisDuplicate {
  constructor(label: string) {
    super({ resource: "Schedule", id: label });
  }
}

/**
 * Thrown when the world frame tick counter is exhausted.
 *
 * @example
 * ```typescript
 * await runOnce(world); // throws IrisTickOverflow after 2^53-1 ticks
 * ```
 */
export class IrisTickOverflow extends IrisLimitExceeded {
  constructor() {
    super({ resource: "World frame tick", max: Number.MAX_SAFE_INTEGER });
  }
}

/**
 * Thrown when the world revision counter is exhausted. Change-detection
 * queries and event reads inside systems advance the counter.
 *
 * @example
 * ```typescript
 * // Inside a system, after 2^53-1 revisions
 * readEvents(world, DamageDealt, () => {}); // throws IrisRevisionOverflow
 * ```
 */
export class IrisRevisionOverflow extends IrisLimitExceeded {
  constructor() {
    super({ resource: "World revision", max: Number.MAX_SAFE_INTEGER });
  }
}

/**
 * Thrown when an operation conflicts with active scheduler execution,
 * such as starting a frame while another is running or resetting a running world.
 *
 * @example
 * ```typescript
 * void runOnce(world);
 * await runOnce(world); // throws IrisSchedulerBusy
 * ```
 */
export class IrisSchedulerBusy extends IrisInvalidState {
  constructor(message: string) {
    super({ message });
  }
}

/**
 * Thrown when system ordering constraints form a cycle.
 *
 * @example
 * ```typescript
 * addSystem(world, a, { before: ["b"] });
 * addSystem(world, b, { before: ["a"] });
 * await runOnce(world); // throws IrisCircularDependency
 * ```
 */
export class IrisCircularDependency extends IrisInvalidState {
  constructor(schedule: string, detail: string) {
    super({ message: `Circular dependency in schedule "${schedule}": ${detail}` });
  }
}

// ============================================================================
// Event Errors
// ============================================================================

/**
 * Thrown when defining an event with a name already in use.
 *
 * @example
 * ```typescript
 * defineEvent("collision");
 * defineEvent("collision"); // throws IrisDuplicateEvent
 * ```
 */
export class IrisDuplicateEvent extends IrisDuplicate {
  constructor(name: string) {
    super({ resource: "Event", id: name });
  }
}

// ============================================================================
// Query Errors
// ============================================================================

/**
 * Thrown when query terms are invalid, such as an empty query, an empty `or()`
 * group, or unsupported modifiers for the operation.
 *
 * @example
 * ```typescript
 * collectEntities(world, []); // throws IrisInvalidQuery
 * ```
 */
export class IrisInvalidQuery extends IrisInvalidArgument {
  constructor(expected: string) {
    super({ expected });
  }
}

/**
 * Thrown when `or()` groups expand into more filter branches than supported.
 *
 * @example
 * ```typescript
 * // or() groups multiply into filter branches
 * collectEntities(world, tooManyOrGroups); // throws IrisQueryLimitExceeded
 * ```
 */
export class IrisQueryLimitExceeded extends IrisLimitExceeded {
  constructor(max: number) {
    super({ resource: "Query filter branches", max });
  }
}

// ============================================================================
// Pair Errors
// ============================================================================

/**
 * Thrown when a pair operation receives an invalid relation or target,
 * such as wildcards in concrete operations or a pair as a pair target.
 *
 * @example
 * ```typescript
 * addComponent(world, entity, pair(Wildcard, target)); // throws IrisInvalidPair
 * ```
 */
export class IrisInvalidPair extends IrisInvalidArgument {
  constructor(expected: string, actual: string) {
    super({ expected, actual });
  }
}

// ============================================================================
// Schema Errors
// ============================================================================

/**
 * Thrown when a vector schema type is created with a size outside 2-16.
 *
 * @example
 * ```typescript
 * Type.f32(32); // throws IrisInvalidVectorSize
 * ```
 */
export class IrisInvalidVectorSize extends IrisInvalidArgument {
  constructor(size: number) {
    super({ expected: "vector size between 2 and 16", actual: String(size) });
  }
}

// ============================================================================
// Condition Errors
// ============================================================================

/**
 * Thrown when a tick interval condition receives a non-positive or unsafe count.
 *
 * @example
 * ```typescript
 * every(0); // throws IrisInvalidInterval
 * ```
 */
export class IrisInvalidInterval extends IrisInvalidArgument {
  constructor(ticks: number) {
    super({ expected: "ticks to be a positive safe integer", actual: String(ticks) });
  }
}
