import type { Schema, SchemaRecord } from "./schema.js";

// ============================================================================
// Type Constants
// ============================================================================

/**
 * ID type constant for entities created with `createEntity`.
 *
 * Compare with the result of {@link extractType} to discriminate ID kinds.
 *
 * @example
 * ```typescript
 * extractType(entity) === ENTITY_TYPE; // true
 * ```
 */
export const ENTITY_TYPE = 0x1;

/**
 * ID type constant for tags defined with `defineTag`.
 *
 * Compare with the result of {@link extractType} to discriminate ID kinds.
 *
 * @example
 * ```typescript
 * extractType(Player) === TAG_TYPE; // true
 * ```
 */
export const TAG_TYPE = 0x2;

/**
 * ID type constant for data components defined with `defineComponent`.
 *
 * Compare with the result of {@link extractType} to discriminate ID kinds.
 *
 * @example
 * ```typescript
 * extractType(Position) === COMPONENT_TYPE; // true
 * ```
 */
export const COMPONENT_TYPE = 0x3;

/**
 * ID type constant for relations defined with `defineRelation`.
 *
 * Compare with the result of {@link extractType} to discriminate ID kinds.
 *
 * @example
 * ```typescript
 * extractType(ChildOf) === RELATIONSHIP_TYPE; // true
 * ```
 */
export const RELATIONSHIP_TYPE = 0x4;

// ============================================================================
// ID Limits
// ============================================================================

/**
 * Bit mask for the 20-bit raw ID field; doubles as the highest raw ID an
 * entity, tag, or component can hold.
 * @internal
 */
export const ID_MASK_20 = 0xfffff;

/**
 * Bit mask for the 8-bit raw ID field of relations; doubles as the highest
 * raw relation ID and the entity generation wrap mask.
 * @internal
 */
export const ID_MASK_8 = 0xff;

// ============================================================================
// Branded Types
// ============================================================================

/**
 * Entity brand for nominal typing.
 */
declare const ENTITY_BRAND: unique symbol;

/**
 * Tag brand for nominal typing.
 */
declare const TAG_BRAND: unique symbol;

/**
 * Component brand for nominal typing.
 */
declare const COMPONENT_BRAND: unique symbol;

/**
 * Relation brand for nominal typing.
 */
declare const RELATION_BRAND: unique symbol;

/**
 * Pair brand for nominal typing.
 */
declare const PAIR_BRAND: unique symbol;

/**
 * Schema brand for carrying schema type in Component.
 */
declare const SCHEMA_BRAND: unique symbol;

/**
 * Name brand for nominal uniqueness across same-shaped definitions.
 */
declare const NAME_BRAND: unique symbol;

/**
 * Pair relation brand for preserving relation identity in pairs.
 */
declare const PAIR_RELATION_BRAND: unique symbol;

/**
 * Pair target brand for preserving target identity in pairs.
 */
declare const PAIR_TARGET_BRAND: unique symbol;

/**
 * Component presence brand for type-safe narrowing.
 */
declare const HAS_COMPONENT_BRAND: unique symbol;

/**
 * Entity ID (branded type).
 *
 * Nominal type preventing accidental mixing of entities with raw numbers.
 */
export type Entity = number & { [ENTITY_BRAND]: true };

/**
 * Tag ID (branded type).
 *
 * Nominal type for component tags defined via defineTag().
 */
export type Tag<N extends string = string> = number & { [TAG_BRAND]: true; [NAME_BRAND]: N };

/**
 * Component ID (branded type).
 *
 * Nominal type for data components with field schemas.
 */
export type Component<S extends SchemaRecord = SchemaRecord, N extends string = string> = number & {
  [COMPONENT_BRAND]: true;
  [SCHEMA_BRAND]: S;
  [NAME_BRAND]: N;
};

/**
 * Relation ID (branded type).
 *
 * Nominal type for relations with optional schema for pair data.
 */
export type Relation<S extends SchemaRecord = SchemaRecord, N extends string = string> = number & {
  [RELATION_BRAND]: true;
  [SCHEMA_BRAND]: S;
  [NAME_BRAND]: N;
};

/**
 * Pair ID (branded type).
 *
 * Nominal type for relation-target pairs. Inherits schema and identity from relation.
 */
export type Pair<R extends Relation = Relation, T = unknown> = number & {
  [PAIR_BRAND]: true;
  [SCHEMA_BRAND]: R extends Relation<infer S> ? S : never;
  [PAIR_RELATION_BRAND]: R;
  [PAIR_TARGET_BRAND]: T;
};

/**
 * Entity or Component ID (union type).
 *
 * Used in function signatures to accept entities, tags, data components, relations, and pairs.
 */
export type EntityId = Entity | Tag | Component | Relation | Pair;

/**
 * Entity ID narrowed to guarantee presence of specific components.
 */
export type EntityWith<C extends EntityId> = EntityId & {
  readonly [HAS_COMPONENT_BRAND]: (c: C) => void;
};

// ============================================================================
// Common Bit Positions
// ============================================================================

/**
 * Pair flag bit position (bit 31).
 * @internal
 */
export const PAIR_FLAG_SHIFT = 31;

/**
 * Type bits position (bits 30-28).
 * @internal
 */
export const TYPE_SHIFT = 28;

/**
 * Type mask (3 bits).
 * @internal
 */
export const TYPE_MASK = 0x7;

// ============================================================================
// Bit Field Constants (Internal)
// ============================================================================

const ID_SHIFT_20 = 0;
const ID_SHIFT_8 = 0;
const META_SHIFT_8 = 20;
const META_MASK_8 = 0xff;
const META_SHIFT_20 = 8;
const META_MASK_20 = 0xfffff;

// ============================================================================
// Encoding Functions
// ============================================================================

/**
 * Type-aware encoding using type-specific bit layouts.
 */
function encode(type: number, rawId: number, meta: number): number {
  switch (type) {
    case RELATIONSHIP_TYPE:
      // Relationship: [0][TYPE][META_20][ID_8]
      return (0 << PAIR_FLAG_SHIFT) | (type << TYPE_SHIFT) | (meta << META_SHIFT_20) | (rawId << ID_SHIFT_8);

    case ENTITY_TYPE:
    case TAG_TYPE:
    case COMPONENT_TYPE:
    default:
      // Entity/Component/Tag: [0][TYPE][META_8][ID_20]
      return (0 << PAIR_FLAG_SHIFT) | (type << TYPE_SHIFT) | (meta << META_SHIFT_8) | (rawId << ID_SHIFT_20);
  }
}

/**
 * Encodes a raw ID and generation into an entity ID.
 *
 * The inverse of {@link extractId} and {@link extractMeta} -- together they
 * round-trip entity IDs through serialized form. Does not allocate or
 * register anything; `createEntity` is the way to obtain new IDs.
 *
 * @param rawId - Raw entity ID (0 to 1,048,575)
 * @param generation - Generation number (0 to 255)
 *
 * @example
 * ```typescript
 * const restored = encodeEntity(savedRawId, savedGeneration);
 * isEntityAlive(world, restored);
 * ```
 */
export function encodeEntity(rawId: number, generation: number): Entity {
  return encode(ENTITY_TYPE, rawId, generation) as Entity;
}

/**
 * Encodes a raw ID into a component ID. `defineComponent` owns allocation.
 * @internal
 */
export function encodeComponent<S extends Record<string, Schema> = Record<string, Schema>>(
  rawId: number
): Component<S> {
  return encode(COMPONENT_TYPE, rawId, 0) as Component<S>;
}

/**
 * Encodes a raw ID into a tag ID. `defineTag` owns allocation.
 * @internal
 */
export function encodeTag(rawId: number): Tag {
  return encode(TAG_TYPE, rawId, 0) as Tag;
}

/**
 * Encodes a raw ID into a relation ID. `defineRelation` owns allocation.
 * @internal
 */
export function encodeRelation<S extends Record<string, Schema> = Record<string, Schema>>(rawId: number): Relation<S> {
  return encode(RELATIONSHIP_TYPE, rawId, 0) as Relation<S>;
}

/**
 * Encodes a relation and target into a pair ID. The public entry point is
 * `pair()`, which also validates the target.
 * @internal
 */
export function encodePair<R extends Relation, T extends EntityId>(relation: R, target: T): Pair<R, T> {
  const relationRawId = extractId(relation);
  const targetType = extractType(target);
  const targetRawId = extractId(target);

  return ((1 << PAIR_FLAG_SHIFT) | (targetType << TYPE_SHIFT) | (targetRawId << META_SHIFT_20) | relationRawId) as Pair<
    R,
    T
  >;
}

// ============================================================================
// Decoding Functions
// ============================================================================

/**
 * Extracts the type tag from an encoded ID.
 *
 * Returns one of {@link ENTITY_TYPE}, {@link TAG_TYPE}, {@link COMPONENT_TYPE},
 * or {@link RELATIONSHIP_TYPE}. Check {@link isPair} first: for a pair the
 * result describes the pair's target, not the pair itself.
 *
 * @example
 * ```typescript
 * const isDefinition = !isPair(id) && extractType(id) !== ENTITY_TYPE;
 * ```
 */
export function extractType(id: number): number {
  return (id >>> TYPE_SHIFT) & TYPE_MASK;
}

/**
 * Extracts the raw numeric ID from an encoded ID.
 *
 * Useful for compact serialization and debug logging; combine with
 * {@link extractMeta} to round-trip entity IDs through {@link encodeEntity}.
 * Meaningful for non-pair IDs only.
 *
 * @example
 * ```typescript
 * console.log(`entity #${extractId(entity)} gen ${extractMeta(entity)}`);
 * ```
 */
export function extractId(id: number): number {
  const type = extractType(id);

  switch (type) {
    case RELATIONSHIP_TYPE:
      // Relationship: 8-bit ID at bits 7-0
      return (id >>> ID_SHIFT_8) & ID_MASK_8;

    case ENTITY_TYPE:
    case TAG_TYPE:
    case COMPONENT_TYPE:
    default:
      // Entity/Component/Tag: 20-bit ID at bits 19-0
      return (id >>> ID_SHIFT_20) & ID_MASK_20;
  }
}

/**
 * Extracts the meta field from an encoded ID: the generation for entities,
 * always zero for tags, components, and relations.
 *
 * With {@link extractId} it captures everything needed to rebuild an entity
 * ID via {@link encodeEntity}.
 *
 * @example
 * ```typescript
 * const generation = extractMeta(entity);
 * ```
 */
export function extractMeta(id: number): number {
  const type = extractType(id);

  switch (type) {
    case RELATIONSHIP_TYPE:
      // Relationship: 20-bit meta at bits 27-8 (unused, always 0)
      return (id >>> META_SHIFT_20) & META_MASK_20;

    case ENTITY_TYPE:
    case TAG_TYPE:
    case COMPONENT_TYPE:
    default:
      // Entity/Component/Tag: 8-bit meta at bits 27-20
      return (id >>> META_SHIFT_8) & META_MASK_8;
  }
}

/**
 * Checks whether an ID is a relation pair.
 *
 * Discriminates pairs from plain IDs when walking mixed ID collections, such
 * as observer payloads. Narrows the type so {@link getPairTarget} accepts the
 * result.
 *
 * @example
 * ```typescript
 * registerObserverCallback(world, "componentAdded", (componentId, entityId) => {
 *   if (isPair(componentId)) {
 *     console.log("pair added:", getPairTarget(world, componentId));
 *   }
 * });
 * ```
 */
export function isPair(id: number): id is Pair {
  return id >>> PAIR_FLAG_SHIFT === 1;
}

/**
 * Checks whether an ID is a plain entity (not a definition or pair).
 * @internal
 */
export function isEntity(id: number): id is Entity {
  // The unmasked shift keeps the pair flag in the comparison, so pairs never match
  return id >>> TYPE_SHIFT === ENTITY_TYPE;
}

/**
 * Checks whether an ID is a relation definition (not a pair).
 * @internal
 */
export function isRelation(id: number): id is Relation {
  // The unmasked shift keeps the pair flag in the comparison, so pairs never match
  return id >>> TYPE_SHIFT === RELATIONSHIP_TYPE;
}

/**
 * Extracts the raw ID from an entity ID, skipping the type dispatch of
 * `extractId` on the registry hot path.
 * @internal
 */
export function extractEntityId(id: Entity): number {
  return id & ID_MASK_20;
}

/**
 * Extracts the relation's raw ID from a pair.
 * @internal
 */
export function extractPairRelationId(pairId: number): number {
  return pairId & ID_MASK_8;
}

/**
 * Extracts the target's raw ID from a pair.
 * @internal
 */
export function extractPairTargetId(pairId: number): number {
  return (pairId >>> META_SHIFT_20) & ID_MASK_20;
}

/**
 * Extracts the target's type tag from a pair.
 * @internal
 */
export function extractPairTargetType(pairId: number): number {
  return (pairId >>> TYPE_SHIFT) & TYPE_MASK;
}
