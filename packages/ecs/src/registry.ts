import type { Component, Relation, Tag } from "./encoding.js";
import { encodeComponent, encodeRelation, encodeTag, ID_MASK_8, ID_MASK_20 } from "./encoding.js";
import { IrisDefinitionLimitExceeded, IrisDuplicateDefinition } from "./error.js";
import type { NonEmptySchema, SchemaRecord } from "./schema.js";
import { assertNonEmptySchema } from "./schema.js";

// ============================================================================
// Component Metadata
// ============================================================================

/**
 * Definition metadata for a tag, component, or relation: name, optional
 * schema, and relation traits.
 * @internal
 */
export type ComponentMeta = {
  /** Component name (user-defined). */
  name: string;
  /** Field schemas for data components (undefined for tags). */
  schema?: SchemaRecord;
  /** If true, a subject holds at most one target for this relation at a time. */
  exclusive?: boolean;
  /** What happens to subjects when a pair target is destroyed. Default is "remove". */
  onDeleteTarget?: "remove" | "delete";
};

// ============================================================================
// Relation Options
// ============================================================================

/**
 * Options accepted by {@link defineRelation}.
 * @internal
 */
export type RelationOptions<S extends SchemaRecord = Record<string, never>> = {
  /** Field schemas for pair data (optional). */
  schema?: NonEmptySchema<S>;
  /** If true, a subject holds at most one target for this relation at a time. */
  exclusive?: boolean;
  /** What happens to subjects when a pair target is destroyed. Default is "remove". */
  onDeleteTarget?: "remove" | "delete";
};

// ============================================================================
// Component Registry
// ============================================================================

/**
 * Registry of all definitions, shared across worlds.
 * @internal
 */
export type ComponentRegistry = {
  /** Component metadata lookup (component ID -> metadata). */
  byId: Map<Tag | Component | Relation, ComponentMeta>;
  /** Definition lookup shared by tags, components, and relations. */
  byName: Map<string, Tag | Component | Relation>;
  /** Next raw ID to allocate for tags. */
  nextTagId: number;
  /** Next raw ID to allocate for data components. */
  nextComponentId: number;
  /** Next raw ID to allocate for relations. */
  nextRelationId: number;
};

/**
 * Global definition registry singleton. Definitions are world-independent, so
 * IDs stay stable across worlds and resets.
 * @internal
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
  /** Component metadata lookup (component ID -> metadata). */
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

/**
 * Rejects names already taken by any tag, component, or relation.
 */
function assertDefinitionNameAvailable(name: string): void {
  if (COMPONENT_REGISTRY.byName.has(name)) {
    throw new IrisDuplicateDefinition(name);
  }
}

// ============================================================================
// Component Definition
// ============================================================================

/**
 * Defines a tag or data component.
 *
 * Definitions are global -- shared by every world and stable across
 * `resetWorld`. Omit the options to create a tag, or provide a non-empty
 * schema to create a data component.
 *
 * @param name - Name, unique across all tags, components, and relations
 * @param options - Data component options; omit for a tag
 * @throws {IrisDuplicateDefinition} If the name is already used by a tag, component, or relation
 * @throws {IrisInvalidArgument} If the schema is empty
 * @throws {IrisDefinitionLimitExceeded} If the tag or component limit (1,048,576) is exceeded
 *
 * @example
 * ```typescript
 * const Player = defineComponent("Player");
 * const Position = defineComponent("Position", {
 *   schema: { x: Type.f32(), y: Type.f32() },
 * });
 * addComponent(world, entity, Player);
 * addComponent(world, entity, [Position, { x: 10, y: 20 }]);
 * ```
 */
export function defineComponent<N extends string>(name: N): Tag<N>;

export function defineComponent<N extends string, S extends SchemaRecord>(
  name: N,
  options: { schema: NonEmptySchema<S> }
): Component<S, N>;

export function defineComponent<N extends string, S extends SchemaRecord>(
  name: N,
  options?: { schema: NonEmptySchema<S> }
): Tag<N> | Component<S, N> {
  if (options !== undefined) {
    assertNonEmptySchema(options.schema);
  }

  assertDefinitionNameAvailable(name);

  if (options !== undefined) {
    const rawId = COMPONENT_REGISTRY.nextComponentId;

    if (rawId > ID_MASK_20) {
      throw new IrisDefinitionLimitExceeded("Component");
    }

    const componentId = encodeComponent<S>(rawId);

    COMPONENT_REGISTRY.byId.set(componentId, {
      name,
      schema: options.schema,
    });
    COMPONENT_REGISTRY.byName.set(name, componentId);

    COMPONENT_REGISTRY.nextComponentId++;

    return componentId as Component<S, N>;
  }

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
// Relation Definition
// ============================================================================

/**
 * Defines a relation for linking entities into pairs.
 *
 * Definitions are global -- shared by every world and stable across
 * `resetWorld`. Options add a schema for per-pair data, the exclusive trait
 * (one target per subject), and the `onDeleteTarget` policy for what happens
 * to subjects when their target is destroyed. Combine with {@link pair} to
 * build the IDs passed to `addComponent`.
 *
 * @param name - Name, unique across all tags, components, and relations
 * @param options - Optional schema and relation traits
 * @throws {IrisDuplicateDefinition} If the name is already used by a tag, component, or relation
 * @throws {IrisInvalidArgument} If the schema is empty
 * @throws {IrisDefinitionLimitExceeded} If the relation limit (256, including the built-in Wildcard) is exceeded
 *
 * @example
 * ```typescript
 * const ChildOf = defineRelation("ChildOf", { exclusive: true, onDeleteTarget: "delete" });
 * addComponent(world, child, pair(ChildOf, parent));
 * ```
 */
export function defineRelation<N extends string, S extends SchemaRecord = Record<string, never>>(
  name: N,
  options?: RelationOptions<S>
): Relation<S, N> {
  if (options?.schema !== undefined) {
    assertNonEmptySchema(options.schema);
  }

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
 * Wildcard relation for query patterns.
 *
 * `pair(ChildOf, Wildcard)` matches entities with any target for the
 * relation; `pair(Wildcard, parent)` matches entities with any relation to
 * that target. Wildcard pairs are query-only: passing one to `addComponent`
 * or `removeComponent` throws IrisInvalidPair.
 *
 * @example
 * ```typescript
 * const children = collectEntities(world, [pair(ChildOf, Wildcard)]);
 * ```
 */
export const Wildcard = defineRelation("Wildcard");

// ============================================================================
// Relation Trait Tags
// ============================================================================

/**
 * Trait tag marking a relation as exclusive: one target per subject.
 *
 * Set through `defineRelation(name, { exclusive: true })`; adding a pair for
 * an exclusive relation replaces the subject's previous target. The trait is
 * attached to the relation itself, so it is queryable like any tag.
 *
 * @example
 * ```typescript
 * const ChildOf = defineRelation("ChildOf", { exclusive: true });
 * hasComponent(world, ChildOf, Exclusive); // true
 * ```
 */
export const Exclusive = defineComponent("Exclusive");

/**
 * Trait tag marking a relation whose subjects are destroyed with their target.
 *
 * Set through `defineRelation(name, { onDeleteTarget: "delete" })`: destroying
 * a target also destroys every subject holding a pair of this relation to it.
 * The trait is attached to the relation itself, so it is queryable like any
 * tag.
 *
 * @example
 * ```typescript
 * const ChildOf = defineRelation("ChildOf", { onDeleteTarget: "delete" });
 * addComponent(world, child, pair(ChildOf, parent));
 * destroyEntity(world, parent); // child is destroyed too
 * ```
 */
export const OnDeleteTarget = defineComponent("OnDeleteTarget");
