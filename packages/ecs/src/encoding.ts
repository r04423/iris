import type { Schema, SchemaRecord } from "./schema.js";

// ============================================================================
// Type Constants
// ============================================================================

/**
 * Entity type constant (0x1).
 */
export const ENTITY_TYPE = 0x1;

/**
 * Tag type constant (0x2).
 */
export const TAG_TYPE = 0x2;

/**
 * Component type constant (0x3).
 */
export const COMPONENT_TYPE = 0x3;

/**
 * Relationship type constant (0x4).
 */
export const RELATIONSHIP_TYPE = 0x4;

// ============================================================================
// ID Limits
// ============================================================================

/**
 * Maximum raw ID for entities, components, and tags (20-bit).
 */
export const ID_MASK_20 = 0xfffff;

/**
 * Maximum raw ID for relationships (8-bit).
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
export type Tag = number & { [TAG_BRAND]: true };

/**
 * Component ID (branded type).
 *
 * Nominal type for data components with field schemas.
 */
export type Component<S extends SchemaRecord = SchemaRecord> = number & {
  [COMPONENT_BRAND]: true;
  [SCHEMA_BRAND]: S;
};

/**
 * Relation ID (branded type).
 *
 * Nominal type for relations with optional schema for pair data.
 */
export type Relation<S extends SchemaRecord = SchemaRecord> = number & {
  [RELATION_BRAND]: true;
  [SCHEMA_BRAND]: S;
};

/**
 * Pair ID (branded type).
 *
 * Nominal type for relation-target pairs. Inherits schema from relation.
 */
export type Pair<R extends Relation = Relation> = number & {
  [PAIR_BRAND]: true;
  [SCHEMA_BRAND]: R extends Relation<infer S> ? S : never;
};

/**
 * Valid targets for relations.
 *
 * Pairs cannot target other pairs to prevent encoding issues.
 */
export type RelationTargetId = Entity | Tag | Component | Relation;

/**
 * Entity or Component ID (union type).
 *
 * Used in function signatures to accept entities, tags, data components, relations, and pairs.
 */
export type EntityId = Entity | Tag | Component | Relation | Pair;

// ============================================================================
// Common Bit Positions
// ============================================================================

/**
 * Pair flag bit position (bit 31).
 */
export const PAIR_FLAG_SHIFT = 31;

/**
 * Type bits position (bits 30-28).
 */
export const TYPE_SHIFT = 28;

/**
 * Type mask (3 bits).
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
 * Encode entity ID from raw ID and generation.
 *
 * @param rawId - Raw entity ID (0 to 1,048,575)
 * @param generation - Generation number (0 to 255)
 * @returns Encoded 32-bit entity ID
 */
export function encodeEntity(rawId: number, generation: number): Entity {
  return encode(ENTITY_TYPE, rawId, generation) as Entity;
}

/**
 * Encode component ID from raw ID.
 *
 * @param rawId - Raw component ID (0 to 1,048,575)
 * @returns Encoded 32-bit component ID
 */
export function encodeComponent<S extends Record<string, Schema> = Record<string, Schema>>(
  rawId: number
): Component<S> {
  return encode(COMPONENT_TYPE, rawId, 0) as Component<S>;
}

/**
 * Encode tag ID from raw ID.
 *
 * @param rawId - Raw tag ID (0 to 1,048,575)
 * @returns Encoded 32-bit tag ID
 */
export function encodeTag(rawId: number): Tag {
  return encode(TAG_TYPE, rawId, 0) as Tag;
}

/**
 * Encode relation ID from raw ID.
 *
 * @param rawId - Raw relation ID (0 to 255)
 * @returns Encoded 32-bit relation ID
 */
export function encodeRelation<S extends Record<string, Schema> = Record<string, Schema>>(rawId: number): Relation<S> {
  return encode(RELATIONSHIP_TYPE, rawId, 0) as Relation<S>;
}

/**
 * Encode a pair from relation and target.
 *
 * @param relation - Relation ID
 * @param target - Target ID (entity, tag, component, or relation)
 * @returns Encoded pair ID
 */
export function encodePair<R extends Relation>(relation: R, target: RelationTargetId): Pair<R> {
  const relationRawId = extractId(relation);
  const targetType = extractType(target);
  const targetRawId = extractId(target);

  return ((1 << PAIR_FLAG_SHIFT) |
    (targetType << TYPE_SHIFT) |
    (targetRawId << META_SHIFT_20) |
    relationRawId) as Pair<R>;
}

// ============================================================================
// Decoding Functions
// ============================================================================

/**
 * Extract type bits from encoded ID.
 *
 * @param id - Encoded ID
 * @returns Type bits (0x0 - 0x7)
 */
export function extractType(id: number): number {
  return (id >>> TYPE_SHIFT) & TYPE_MASK;
}

/**
 * Extract raw ID from encoded ID (type-aware).
 *
 * @param id - Encoded ID (any non-pair type)
 * @returns Raw ID (20-bit for entities/components/tags, 8-bit for relationships)
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
 * Extract meta field from encoded ID (type-aware).
 *
 * @param id - Encoded ID (any non-pair type)
 * @returns Meta value (generation for entities, 0 for components/tags/relationships)
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
 * Check if ID is a pair.
 *
 * @param id - Encoded ID
 * @returns True if bit 31 is set, false otherwise
 */
export function isPair(id: number): id is Pair {
  return id >>> PAIR_FLAG_SHIFT === 1;
}

/**
 * Extract relation raw ID from pair.
 *
 * @param pairId - Encoded pair ID
 * @returns Relation raw ID (8-bit)
 */
export function extractPairRelationId(pairId: number): number {
  return pairId & ID_MASK_8;
}

/**
 * Extract target raw ID from pair.
 *
 * @param pairId - Encoded pair ID
 * @returns Target raw ID (20-bit)
 */
export function extractPairTargetId(pairId: number): number {
  return (pairId >>> META_SHIFT_20) & ID_MASK_20;
}

/**
 * Extract target type from pair.
 *
 * @param pairId - Encoded pair ID
 * @returns Target type bits (3-bit)
 */
export function extractPairTargetType(pairId: number): number {
  return (pairId >>> TYPE_SHIFT) & TYPE_MASK;
}
