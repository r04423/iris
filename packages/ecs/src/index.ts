// ============================================================================
// Errors
// ============================================================================

export { assert, Duplicate, InvalidArgument, InvalidState, IrisError, LimitExceeded, NotFound } from "./error.js";

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
  emitComponentChanged as markComponentChanged,
  getComponentValue,
  getComponentVectorValue,
  getComponentVectorView,
  hasComponent,
  removeComponent,
  setComponentValue,
  setComponentVectorValue,
} from "./component.js";

// ============================================================================
// Registry Operations
// ============================================================================

export { defineComponent, defineRelation, defineTag, Exclusive, OnDeleteTarget, Wildcard } from "./registry.js";

// ============================================================================
// Relation Operations
// ============================================================================

export { getPairRelation, getPairTarget, getRelationTargets, pair } from "./relation.js";

// ============================================================================
// Resource Operations
// ============================================================================

export {
  addResource,
  getResourceValue,
  getResourceVectorValue,
  getResourceVectorView,
  hasResource,
  removeResource,
  setResourceValue,
  setResourceVectorValue,
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
  ensureQuery as cacheQuery,
  not,
  queryColumns,
  queryEntities,
  queryFirstEntity,
} from "./query.js";

// ============================================================================
// System Operations
// ============================================================================

export {
  addSystem,
  addSystemSet,
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
  Update,
} from "./scheduler.js";

// ============================================================================
// Type Definitions
// ============================================================================

export type { ActionGetter, ActionInitializer, Actions } from "./actions.js";
export type { ComponentEntry, ValidateEntries } from "./component.js";
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
  ColumnsTuple,
  ExtractIncluded,
  ModifierType,
  NotModifier,
  QueryMeta,
  QueryModifier,
} from "./query.js";
export type {
  ScheduleLabel,
  SystemFactory,
  SystemMeta,
  SystemOptions,
  SystemReference,
  SystemRunner,
  SystemSetLabel,
  SystemSetMeta,
  SystemSetOptions,
  SystemTick,
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

// ============================================================================
// Entity Encoding Utilities
// ============================================================================

export {
  COMPONENT_TYPE,
  ENTITY_TYPE,
  encodeEntity,
  extractId,
  extractMeta,
  extractType,
  isPair,
  RELATIONSHIP_TYPE,
  TAG_TYPE,
} from "./encoding.js";
