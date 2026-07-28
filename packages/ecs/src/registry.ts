import type { Component, Relation, Tag } from "./encoding.js";
import { encodeComponent, encodeRelation, encodeTag, ID_MASK_8, ID_MASK_20 } from "./encoding.js";
import { IrisDefinitionLimitExceeded, IrisDuplicateDefinition } from "./error.js";
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
   * Definition lookup shared by tags, components, and relations.
   */
  byName: Map<string, Tag | Component | Relation>;
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
  byName: new Map(),
  nextTagId: 0,
  nextComponentId: 0,
  nextRelationId: 0,
};

// ============================================================================
// Component State
// ============================================================================

/**
 * Component registry view exposed on a world.
 */
export type ComponentState = {
  /**
   * Component metadata lookup (component ID -> metadata).
   */
  byId: Map<Tag | Component | Relation, ComponentMeta>;
};

/**
 * Creates the world's component registry view.
 * Aliases the global registry: definitions are world-independent and survive
 * world resets, so there is no reset counterpart.
 * @internal
 */
export function createComponentState(): ComponentState {
  return {
    byId: COMPONENT_REGISTRY.byId,
  };
}

// ============================================================================
// Definition Name Validation
// ============================================================================

/** @internal */
function assertDefinitionNameAvailable(name: string): void {
  if (COMPONENT_REGISTRY.byName.has(name)) {
    throw new IrisDuplicateDefinition(name);
  }
}

// ============================================================================
// Tag Definition
// ============================================================================

/**
 * Defines a tag component. Tags are lightweight markers without data.
 * @param name - Human-readable tag name for debugging
 * @returns Encoded tag ID
 * @throws {IrisDuplicateDefinition} If the name is already used by a tag, component, or relation
 * @throws {IrisDefinitionLimitExceeded} If tag limit (1,048,576) exceeded
 * @example
 * const Player = defineTag("Player");
 * addComponent(world, entity, Player);
 */
export function defineTag<N extends string>(name: N): Tag<N> {
  assertDefinitionNameAvailable(name);

  const rawId = COMPONENT_REGISTRY.nextTagId;

  if (rawId > ID_MASK_20) {
    throw new IrisDefinitionLimitExceeded("Tag");
  }

  const tagId = encodeTag(rawId);

  COMPONENT_REGISTRY.byId.set(tagId, {
    name,
    schema: undefined,
  });
  COMPONENT_REGISTRY.byName.set(name, tagId);

  COMPONENT_REGISTRY.nextTagId++;

  return tagId as Tag<N>;
}

// ============================================================================
// Component Definition
// ============================================================================

/**
 * Defines a data component with a typed schema for storage.
 * @param name - Human-readable component name for debugging
 * @param schema - Field schema record defining data layout
 * @returns Encoded component ID with schema type
 * @throws {IrisDuplicateDefinition} If the name is already used by a tag, component, or relation
 * @throws {IrisDefinitionLimitExceeded} If component limit (1,048,576) exceeded
 * @example
 * const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });
 * addComponent(world, entity, Position, { x: 10, y: 20 });
 */
export function defineComponent<N extends string, S extends SchemaRecord>(name: N, schema: S): Component<S, N> {
  assertDefinitionNameAvailable(name);

  const rawId = COMPONENT_REGISTRY.nextComponentId;

  if (rawId > ID_MASK_20) {
    throw new IrisDefinitionLimitExceeded("Component");
  }

  const componentId = encodeComponent<S>(rawId);

  COMPONENT_REGISTRY.byId.set(componentId, {
    name,
    schema,
  });
  COMPONENT_REGISTRY.byName.set(name, componentId);

  COMPONENT_REGISTRY.nextComponentId++;

  return componentId as Component<S, N>;
}

// ============================================================================
// Relation Definition
// ============================================================================

/**
 * Defines a relation for entity-to-entity relationships.
 * @param name - Human-readable relation name for debugging
 * @param options - Configuration: schema for data, exclusive trait, delete behavior
 * @returns Encoded relation ID with schema type
 * @throws {IrisDuplicateDefinition} If the name is already used by a tag, component, or relation
 * @throws {IrisDefinitionLimitExceeded} If relation limit (256) exceeded
 * @example
 * const ChildOf = defineRelation("ChildOf", { exclusive: true, onDeleteTarget: "delete" });
 * addComponent(world, child, pair(ChildOf, parent));
 */
export function defineRelation<N extends string, S extends SchemaRecord = Record<string, never>>(
  name: N,
  options?: RelationOptions<S>
): Relation<S, N> {
  assertDefinitionNameAvailable(name);

  const rawId = COMPONENT_REGISTRY.nextRelationId;

  if (rawId > ID_MASK_8) {
    throw new IrisDefinitionLimitExceeded("Relation");
  }

  const relationId = encodeRelation<S>(rawId);

  COMPONENT_REGISTRY.byId.set(relationId, {
    name,
    schema: options?.schema,
    exclusive: options?.exclusive,
    onDeleteTarget: options?.onDeleteTarget,
  });
  COMPONENT_REGISTRY.byName.set(name, relationId);

  COMPONENT_REGISTRY.nextRelationId++;

  return relationId as Relation<S, N>;
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
