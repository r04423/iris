// ============================================================================
// Errors
// ============================================================================

export {
  IrisCircularDependency,
  IrisDefinitionLimitExceeded,
  IrisDuplicate,
  IrisDuplicateDefinition,
  IrisDuplicateEvent,
  IrisDuplicateName,
  IrisDuplicateSchedule,
  IrisDuplicateSystem,
  IrisDuplicateSystemSet,
  IrisEntityLimitExceeded,
  IrisEntityNotFound,
  IrisError,
  IrisInvalidArgument,
  IrisInvalidInterval,
  IrisInvalidName,
  IrisInvalidPair,
  IrisInvalidQuery,
  IrisInvalidState,
  IrisInvalidSystemName,
  IrisInvalidVectorSize,
  IrisLimitExceeded,
  IrisNotFound,
  IrisQueryLimitExceeded,
  IrisRevisionOverflow,
  IrisScheduleNotFound,
  IrisSchedulerBusy,
  IrisSystemNotFound,
  IrisSystemSetNotFound,
  IrisTickOverflow,
} from "./error.js";

// ============================================================================
// Conditions
// ============================================================================

export { defineCondition, every, once } from "./conditions.js";

// ============================================================================
// World Operations
// ============================================================================

export { createWorld, resetWorld } from "./world.js";

// ============================================================================
// Entity Operations
// ============================================================================

export { createEntity, destroyEntity, isEntityAlive } from "./entity.js";

// ============================================================================
// Component Operations
// ============================================================================

export {
  addComponent,
  addComponents,
  getComponent,
  getComponentValue,
  getComponentView,
  hasComponent,
  markComponentChanged,
  removeComponent,
  removeComponents,
  setComponent,
  setComponentValue,
} from "./component.js";

// ============================================================================
// Registry Operations
// ============================================================================

export { defineComponent, defineRelation, Exclusive, OnDeleteTarget, Wildcard } from "./registry.js";

// ============================================================================
// Relation Operations
// ============================================================================

export { isPair } from "./encoding.js";
export { getPairRelation, getPairTarget, getRelationTargets, pair } from "./relation.js";

// ============================================================================
// Resource Operations
// ============================================================================

export {
  addResource,
  getResource,
  getResourceValue,
  getResourceView,
  hasResource,
  markResourceChanged,
  removeResource,
  setResource,
  setResourceValue,
} from "./resource.js";

// ============================================================================
// Name System
// ============================================================================

export { getName, lookupByName, Name, removeName, setName } from "./name.js";

// ============================================================================
// Query Operations
// ============================================================================

export {
  added,
  changed,
  collectEntities,
  not,
  or,
  queryColumns as EXPERIMENTAL_queryColumns,
  queryEntities as EXPERIMENTAL_queryEntities,
  queryFirstEntity,
} from "./query.js";

// ============================================================================
// System Operations
// ============================================================================

export {
  addSystem,
  addSystemSet,
  addSystems,
  animationFrameDriver,
  createTimeoutDriver,
  defineSchedule,
  defineSystem,
  defineSystemSet,
  First,
  insertScheduleAfter,
  insertScheduleBefore,
  Last,
  PostUpdate,
  PreUpdate,
  run,
  runOnce,
  Shutdown,
  Startup,
  stop,
  suspend,
  Update,
} from "./scheduler.js";

// ============================================================================
// Type Definitions
// ============================================================================

export type { ActionGetter, ActionInitializer, Actions } from "./actions.js";
export type { ComponentEntry, EntryComponent, ValidateEntries } from "./component.js";
export type { Condition } from "./conditions.js";
export type {
  Component,
  Entity,
  EntityId,
  EntityWith,
  Pair,
  Relation,
  Tag,
} from "./encoding.js";
export type { Event, EventSchema, PendingEvent } from "./event.js";
export type { FilterTerms } from "./filters.js";
export type { EventPayloads, EventType, Observer, ObserverMeta } from "./observer.js";
export type {
  AddedModifier,
  ChangedModifier,
  ColumnsTuple as EXPERIMENTAL_ColumnsTuple,
  ExtractIncluded,
  ModifierType,
  NotModifier,
  OrModifier,
  QueryModifier,
} from "./query.js";
export type {
  FrameDriver,
  ScheduleLabel,
  System,
  SystemOptions,
  SystemReference,
  SystemSetLabel,
  SystemSetOptions,
  SystemsOptions,
} from "./scheduler.js";
export type {
  InferSchema,
  InferSchemaRecord,
  ScalarFields,
  Schema,
  SchemaRecord,
  TypedArrayInstance,
  VectorFields,
  VectorTuple,
} from "./schema.js";
export type { World } from "./world.js";

// ============================================================================
// Event System
// ============================================================================

export {
  clearEvents,
  collectEvents,
  countEvents,
  defineEvent,
  emitEvent,
  hasEvents,
  readEvents,
  readLastEvent,
} from "./event.js";

// ============================================================================
// Removal Detection
// ============================================================================

export { removed } from "./removal.js";

// ============================================================================
// Observers
// ============================================================================

export { registerObserverCallback, unregisterObserverCallback } from "./observer.js";

// ============================================================================
// Schema Factories
// ============================================================================

export { Type } from "./schema.js";

// ============================================================================
// Actions
// ============================================================================

export { defineActions } from "./actions.js";
