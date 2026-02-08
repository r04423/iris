import type { Component, Relation, Tag } from "./encoding.js";
import { encodeComponent, encodeRelation, encodeTag, ID_MASK_8, ID_MASK_20 } from "./encoding.js";
import { assert, LimitExceeded } from "./error.js";
import type { SchemaRecord } from "./schema.js";

// ============================================================================
// Component Metadata
// ============================================================================

/**
 * Component metadata.
 *
 * Stores component name, optional schema, and relation traits.
 */
export type ComponentMeta = {
  /**
   * Component name (user-defined).
   */
  name: string;

  /**
   * Field schemas for data components (undefined for tags).
   */
  schema?: SchemaRecord;

  /**
   * If true, entity can only have one target at a time for this relation.
   */
  exclusive?: boolean;

  /**
   * What happens when a pair target is destroyed. Default is "remove".
   */
  onDeleteTarget?: "remove" | "delete";
};

// ============================================================================
// Relation Options
// ============================================================================

/**
 * Options for defining relations.
 *
 * Controls relation behavior including exclusivity and delete policies.
 */
export type RelationOptions<S extends SchemaRecord = Record<string, never>> = {
  /**
   * Field schemas for pair data (optional).
   */
  schema?: S;

  /**
   * If true, entity can only have one target for this relation.
   */
  exclusive?: boolean;

  /**
   * What happens when a pair target is destroyed. Default is "remove".
   */
  onDeleteTarget?: "remove" | "delete";
};

// ============================================================================
// Component Registry
// ============================================================================

/**
 * Global singleton storing all component metadata across all worlds.
 */
export type ComponentRegistry = {
  /**
   * Component metadata lookup (component ID -> metadata).
   */
  byId: Map<Tag | Component | Relation, ComponentMeta>;
  /**
   * Next raw ID to allocate for tags.
   */
  nextTagId: number;
  /**
   * Next raw ID to allocate for data components.
   */
  nextComponentId: number;
  /**
   * Next raw ID to allocate for relations.
   */
  nextRelationId: number;
};

/**
 * Global component registry singleton.
 */
export const COMPONENT_REGISTRY: ComponentRegistry = {
  byId: new Map(),
  nextTagId: 0,
  nextComponentId: 0,
  nextRelationId: 0,
};

// ============================================================================
// Tag Definition
// ============================================================================

/**
 * Defines a tag component. Tags are lightweight markers without data.
 * @param name - Human-readable tag name for debugging
 * @returns Encoded tag ID
 * @throws {LimitExceeded} If tag limit (1,048,576) exceeded
 * @example
 * const Player = defineTag("Player");
 * addTag(world, entity, Player);
 */
export function defineTag(name: string): Tag {
  const rawId = COMPONENT_REGISTRY.nextTagId;

  assert(rawId <= ID_MASK_20, LimitExceeded, { resource: "Tag", max: ID_MASK_20 });

  const tagId = encodeTag(rawId);

  COMPONENT_REGISTRY.byId.set(tagId, {
    name,
    schema: undefined,
  });

  COMPONENT_REGISTRY.nextTagId++;

  return tagId;
}

// ============================================================================
// Component Definition
// ============================================================================

/**
 * Defines a data component with a typed schema for storage.
 * @param name - Human-readable component name for debugging
 * @param schema - Field schema record defining data layout
 * @returns Encoded component ID with schema type
 * @throws {LimitExceeded} If component limit (1,048,576) exceeded
 * @example
 * const Position = defineComponent("Position", { x: Type.f32, y: Type.f32 });
 * set(world, entity, Position, { x: 10, y: 20 });
 */
export function defineComponent<S extends SchemaRecord>(name: string, schema: S): Component<S> {
  const rawId = COMPONENT_REGISTRY.nextComponentId;

  assert(rawId <= ID_MASK_20, LimitExceeded, { resource: "Component", max: ID_MASK_20 });

  const componentId = encodeComponent<S>(rawId);

  COMPONENT_REGISTRY.byId.set(componentId, {
    name,
    schema,
  });

  COMPONENT_REGISTRY.nextComponentId++;

  return componentId;
}

// ============================================================================
// Relation Definition
// ============================================================================

/**
 * Defines a relation for entity-to-entity relationships.
 * @param name - Human-readable relation name for debugging
 * @param options - Configuration: schema for data, exclusive trait, delete behavior
 * @returns Encoded relation ID with schema type
 * @throws {LimitExceeded} If relation limit (256) exceeded
 * @example
 * const ChildOf = defineRelation("ChildOf", { exclusive: true, onDeleteTarget: "delete" });
 * addPair(world, child, ChildOf, parent);
 */
export function defineRelation<S extends SchemaRecord = Record<string, never>>(
  name: string,
  options?: RelationOptions<S>
): Relation<S> {
  const rawId = COMPONENT_REGISTRY.nextRelationId;

  assert(rawId <= ID_MASK_8, LimitExceeded, { resource: "Relation", max: ID_MASK_8 });

  const relationId = encodeRelation<S>(rawId);

  COMPONENT_REGISTRY.byId.set(relationId, {
    name,
    schema: options?.schema,
    exclusive: options?.exclusive,
    onDeleteTarget: options?.onDeleteTarget,
  });

  COMPONENT_REGISTRY.nextRelationId++;

  return relationId;
}

// ============================================================================
// Built-in Relations
// ============================================================================

/**
 * Wildcard relation for query patterns. Reserved as relation ID 0.
 * - `pair(Wildcard, target)` matches all entities targeting target
 * - `pair(relation, Wildcard)` matches entities with any target for relation
 */
export const Wildcard = defineRelation("Wildcard");

// ============================================================================
// Relation Trait Tags
// ============================================================================

/**
 * Marks a relation as exclusive (one target per subject).
 * Adding a pair with an exclusive relation auto-removes any existing pair with that relation.
 */
export const Exclusive = defineTag("Exclusive");

/**
 * Cascade delete subjects when target is destroyed.
 * When an entity is destroyed, all entities with a pair targeting it are also destroyed.
 */
export const OnDeleteTarget = defineTag("OnDeleteTarget");
