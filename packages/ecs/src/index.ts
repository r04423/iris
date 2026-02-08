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
  emitComponentChanged,
  getComponentValue,
  hasComponent,
  removeComponent,
  setComponentValue,
} from "./component.js";

// ============================================================================
// Registry Operations
// ============================================================================

export { defineComponent, defineRelation, defineTag, Wildcard } from "./registry.js";

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
  hasResource,
  removeResource,
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
  destroyQuery,
  ensureQuery,
  fetchEntities,
  fetchEntitiesWithQuery,
  fetchFirstEntity,
  not,
} from "./query.js";

// ============================================================================
// System Operations
// ============================================================================

export {
  addSystem,
  buildSchedule,
  executeSchedule,
  executeScheduleAsync,
} from "./scheduler.js";

// ============================================================================
// Type Definitions
// ============================================================================

export type { ActionGetter, ActionInitializer, Actions } from "./actions.js";
export type { Component, Entity, EntityId, Pair, Relation, RelationTargetId, Tag } from "./encoding.js";
export type { Event, EventSchema } from "./event.js";
export type { FilterTerms } from "./filters.js";
export type { AddedModifier, ChangedModifier, ModifierType, NotModifier, QueryMeta, QueryModifier } from "./query.js";
export type { ScheduleId, SystemMeta, SystemOptions, SystemRunner } from "./scheduler.js";
export type { InferSchemaRecord, Schema, SchemaRecord } from "./schema.js";
export type { World } from "./world.js";

// ============================================================================
// Event System
// ============================================================================

export {
  clearEvents,
  countEvents,
  defineEvent,
  emitEvent,
  fetchEvents,
  fetchLastEvent,
  flushEvents,
  hasEvents,
} from "./event.js";

// ============================================================================
// Removal Detection
// ============================================================================

export { removed } from "./removal.js";

// ============================================================================
// Observers
// ============================================================================

export type { EventPayloads, EventType, Observer, ObserverMeta } from "./observer.js";
export { registerObserverCallback, unregisterObserverCallback } from "./observer.js";

// ============================================================================
// Schema Factories
// ============================================================================

export { Type } from "./schema.js";

// ============================================================================
// Actions
// ============================================================================

export { defineActions } from "./actions.js";
