import type { EntityId } from "./encoding.js";
import { addEntityRecord, removeEntityRecord } from "./entity.js";
import { fireObserverEvent } from "./observer.js";
import type { Schema, SchemaRecord, TypedArrayConstructor, TypedArrayInstance, VectorSchema } from "./schema.js";
import { Type } from "./schema.js";
import type { World } from "./world.js";

// ============================================================================
// Column Storage Types
// ============================================================================

/**
 * Column storage type.
 *
 * Union of typed arrays (numeric values) and regular arrays (primitives/reference values).
 */
export type Column = Int8Array | Int16Array | Int32Array | Uint32Array | Float32Array | Float64Array | unknown[];

/**
 * Field columns map.
 *
 * Maps field names to their storage columns for a single component.
 */
export type FieldColumns = {
  [fieldName: string]: Column;
};

/**
 * Typed array storage with narrowed numeric indexed access.
 *
 * @internal
 */
type NarrowedTypedArray<T extends number> = TypedArrayInstance & { [index: number]: T };

/**
 * Maps an inferred scalar value type to its column storage type.
 *
 * @internal
 */
type FieldColumnOf<T> = [T] extends [number] ? NarrowedTypedArray<T & number> : T[];

/**
 * Map a schema record to its column types.
 *
 * Each field maps to the runtime array type used for storage.
 *
 * @internal
 */
export type FieldColumnsOf<S extends SchemaRecord> = {
  [K in keyof S]: S[K] extends VectorSchema
    ? TypedArrayInstance
    : S[K] extends Schema<infer T> & { kind: "generic" }
      ? T[]
      : S[K] extends Schema<infer T>
        ? FieldColumnOf<T>
        : unknown[];
};

/**
 * Component revision stamp storage for change detection.
 *
 * Parallel arrays to entity rows tracking when components were added/changed.
 */
export type ComponentTicks = {
  added: Float64Array;
  changed: Float64Array;
};

// ============================================================================
// Archetype Type
// ============================================================================

/**
 * Archetype structure.
 *
 * Groups entities with identical component sets for cache-efficient iteration.
 */
export type Archetype = {
  types: EntityId[];
  typesSet: Set<EntityId>;
  hash: string;
  entities: EntityId[];
  columns: Map<EntityId, FieldColumns>;
  schemas: Map<EntityId, SchemaRecord>;
  edges: Map<EntityId, Archetype>;
  capacity: number;
  ticks: Map<EntityId, ComponentTicks>;
};

// ============================================================================
// Constants
// ============================================================================

/**
 * Initial capacity when first entity is added to an archetype.
 */
const INITIAL_CAPACITY = 16;

/**
 * Schema for revision stamp columns (Float64Array).
 */
const REVISION_SCHEMA = Type.f64();

// ============================================================================
// Column Utilities
// ============================================================================

/**
 * Derives the stride of a column from its length and the archetype capacity.
 * Scalar columns return 1, vector columns return their stride (e.g., 2 for vec2).
 *
 * @internal
 */
export function getColumnStride(column: Column, capacity: number): number {
  if (Array.isArray(column)) {
    return 1;
  }

  return column.length / capacity;
}

/**
 * Allocates a column based on schema type (TypedArray for numbers, Array for primitives/references).
 */
function allocateColumn(schema: Schema, capacity: number): Column {
  // Vector columns interleave all elements per entity: [x0,y0,x1,y1,...] for stride 2
  if (schema.kind === "vector") {
    const TypedArrayCtor = schema.arrayConstructor as TypedArrayConstructor;
    return new TypedArrayCtor(capacity * schema.stride!);
  }

  if (schema.kind === "typed") {
    const TypedArrayCtor = schema.arrayConstructor as TypedArrayConstructor;
    return new TypedArrayCtor(capacity);
  }

  return [];
}

/**
 * Resizes a column to new capacity, preserving existing data. Regular arrays need no resize.
 */
function resizeColumn(column: Column, oldCapacity: number, newCapacity: number): Column {
  if (Array.isArray(column)) {
    return column;
  }

  const stride = getColumnStride(column, oldCapacity);
  const TypedArrayCtor = column.constructor as TypedArrayConstructor;
  const newColumn = new TypedArrayCtor(newCapacity * stride);

  newColumn.set(column);

  return newColumn;
}

/**
 * Copies one entity's slot between columns of the same field.
 * Vector columns store `stride` contiguous elements per entity.
 */
function copyColumnSlot(destColumn: Column, destRow: number, srcColumn: Column, srcRow: number, stride: number): void {
  if (stride === 1) {
    destColumn[destRow] = srcColumn[srcRow];

    return;
  }

  const destOffset = destRow * stride;
  const srcOffset = srcRow * stride;

  for (let s = 0; s < stride; s++) {
    destColumn[destOffset + s] = srcColumn[srcOffset + s];
  }
}

/**
 * Clears a column slot (undefined for arrays, 0 for typed arrays).
 */
function clearColumn(column: Column, index: number, capacity: number): void {
  if (Array.isArray(column)) {
    column[index] = undefined;
    return;
  }

  const stride = getColumnStride(column, capacity);
  const offset = index * stride;

  for (let s = 0; s < stride; s++) {
    column[offset + s] = 0;
  }
}

// ============================================================================
// Hashing
// ============================================================================

/**
 * Hashes a sorted array of type IDs into a unique archetype key.
 *
 * @param types - Sorted type IDs
 * @returns Colon-delimited hash key (e.g., "1:5:12")
 *
 * @example
 * ```ts
 * const hash = hashArchetypeTypes([1, 5, 12]); // "1:5:12"
 * ```
 */
export function hashArchetypeTypes(types: EntityId[]): string {
  return types.join(":");
}

// ============================================================================
// Archetype Creation
// ============================================================================

/**
 * Creates an archetype from sorted type IDs and their schemas.
 * Columns are allocated lazily on first entity insertion to avoid
 * memory allocation for transitional archetypes (graph traversal nodes).
 *
 * @param sortedTypes - Type IDs in ascending order
 * @param schemas - Map of type ID to field schemas
 * @returns New archetype with empty entity storage
 *
 * @example
 * ```ts
 * const archetype = createArchetype([positionId, velocityId], schemas);
 * ```
 */
export function createArchetype(sortedTypes: EntityId[], schemas: Map<EntityId, SchemaRecord>): Archetype {
  return {
    types: sortedTypes,
    typesSet: new Set(sortedTypes),
    hash: hashArchetypeTypes(sortedTypes),
    entities: [],
    columns: new Map<EntityId, FieldColumns>(),
    schemas,
    edges: new Map(),
    capacity: 0,
    ticks: new Map<EntityId, ComponentTicks>(),
  };
}

/**
 * Registers an archetype in the world's lookup table, updates entity records,
 * and fires the archetypeCreated observer event.
 *
 * @param world - World to register archetype in
 * @param archetype - Archetype to register
 *
 * @example
 * ```ts
 * const archetype = createArchetype(types, schemas);
 * registerArchetype(world, archetype);
 * ```
 */
export function registerArchetype(world: World, archetype: Archetype): void {
  world.archetypes.byId.set(archetype.hash, archetype);
  addEntityRecord(world, archetype);
  fireObserverEvent(world, "archetypeCreated", archetype);
}

/**
 * Creates an archetype and registers it in the world.
 *
 * @param world - World to register archetype in
 * @param types - Sorted type IDs for the archetype
 * @param schemas - Map of type ID to field schemas
 * @returns Newly created and registered archetype
 *
 * @example
 * ```ts
 * const archetype = createAndRegisterArchetype(world, [positionId], schemas);
 * ```
 */
export function createAndRegisterArchetype(
  world: World,
  types: EntityId[],
  schemas: Map<EntityId, SchemaRecord>
): Archetype {
  const archetype = createArchetype(types, schemas);
  registerArchetype(world, archetype);
  return archetype;
}

// ============================================================================
// Archetype State
// ============================================================================

/**
 * Archetype registry and transition graph.
 */
export type ArchetypeState = {
  /**
   * Root archetype (empty - no components).
   */
  root: Archetype;

  /**
   * Archetype lookup by hash key (hash -> archetype).
   */
  byId: Map<string, Archetype>;
};

/**
 * Creates an empty archetype registry with an unregistered root archetype.
 * The caller registers the root once observers are in place.
 * @internal
 */
export function createArchetypeState(): ArchetypeState {
  return {
    root: createArchetype([], new Map()),
    byId: new Map(),
  };
}

/**
 * Clears the world's archetype registry and replaces the root with a fresh,
 * unregistered archetype. Edges are cleared to break circular references.
 * @internal
 */
export function resetArchetypeState(world: World): void {
  for (const archetype of world.archetypes.byId.values()) {
    archetype.edges.clear();
  }

  world.archetypes.byId.clear();
  world.archetypes.root = createArchetype([], new Map());
}

// ============================================================================
// Capacity Management
// ============================================================================

/**
 * Ensures archetype has capacity for requiredCapacity entities.
 * Allocates columns and revision arrays on first entity, grows 4x thereafter.
 */
function ensureArchetypeCapacity(archetype: Archetype, requiredCapacity: number): void {
  if (archetype.capacity >= requiredCapacity) return;

  if (archetype.capacity === 0) {
    const initialCapacity = Math.max(INITIAL_CAPACITY, requiredCapacity);

    for (const [componentId, fieldSchemas] of archetype.schemas.entries()) {
      const fieldColumns: FieldColumns = {};

      for (const fieldName in fieldSchemas) {
        fieldColumns[fieldName] = allocateColumn(fieldSchemas[fieldName]!, initialCapacity);
      }

      archetype.columns.set(componentId, fieldColumns);
    }

    for (const componentId of archetype.types) {
      archetype.ticks.set(componentId, {
        added: allocateColumn(REVISION_SCHEMA, initialCapacity) as Float64Array,
        changed: allocateColumn(REVISION_SCHEMA, initialCapacity) as Float64Array,
      });
    }

    archetype.capacity = initialCapacity;
    return;
  }

  let newCapacity = archetype.capacity;
  while (newCapacity < requiredCapacity) {
    newCapacity *= 4;
  }

  for (const fieldColumns of archetype.columns.values()) {
    for (const fieldName in fieldColumns) {
      fieldColumns[fieldName] = resizeColumn(fieldColumns[fieldName]!, archetype.capacity, newCapacity);
    }
  }

  for (const componentTicks of archetype.ticks.values()) {
    componentTicks.added = resizeColumn(componentTicks.added, archetype.capacity, newCapacity) as Float64Array;
    componentTicks.changed = resizeColumn(componentTicks.changed, archetype.capacity, newCapacity) as Float64Array;
  }

  archetype.capacity = newCapacity;
}

// ============================================================================
// Entity Movement
// ============================================================================

/**
 * Adds an entity to an archetype, initializing revision tracking for change detection.
 *
 * @param archetype - Target archetype
 * @param entityId - Entity to add
 * @param revision - Current world revision for change detection (defaults to 0)
 * @returns Row index where entity was inserted
 *
 * @example
 * ```ts
 * const row = addEntityToArchetype(archetype, entityId, world.revision);
 * ```
 */
export function addEntityToArchetype(archetype: Archetype, entityId: EntityId, revision = 0): number {
  const row = archetype.entities.length;
  ensureArchetypeCapacity(archetype, row + 1);
  archetype.entities.push(entityId);

  for (const componentTicks of archetype.ticks.values()) {
    componentTicks.added[row] = revision;
    componentTicks.changed[row] = revision;
  }

  return row;
}

/**
 * Removes an entity from an archetype using swap-and-pop for O(1) removal.
 * The last entity in the archetype is moved into the vacated row.
 *
 * @param archetype - Archetype to remove entity from
 * @param row - Row index of entity to remove
 * @returns Entity ID that was swapped into the row, or undefined if row was last
 *
 * @example
 * ```ts
 * const swapped = removeEntityFromArchetypeByRow(archetype, row);
 * if (swapped) updateEntityRecord(world, swapped, archetype, row);
 * ```
 */
export function removeEntityFromArchetypeByRow(archetype: Archetype, row: number): EntityId | undefined {
  const lastIdx = archetype.entities.length - 1;
  let swappedEntityId: EntityId | undefined;

  if (row !== lastIdx) {
    swappedEntityId = archetype.entities[lastIdx]!;
    archetype.entities[row] = swappedEntityId;

    for (const fieldColumns of archetype.columns.values()) {
      for (const fieldName in fieldColumns) {
        const column = fieldColumns[fieldName]!;
        copyColumnSlot(column, row, column, lastIdx, getColumnStride(column, archetype.capacity));
      }
    }

    for (const componentTicks of archetype.ticks.values()) {
      componentTicks.added[row] = componentTicks.added[lastIdx]!;
      componentTicks.changed[row] = componentTicks.changed[lastIdx]!;
    }
  }

  archetype.entities.pop();

  for (const fieldColumns of archetype.columns.values()) {
    for (const fieldName in fieldColumns) {
      clearColumn(fieldColumns[fieldName]!, lastIdx, archetype.capacity);
    }
  }

  for (const componentTicks of archetype.ticks.values()) {
    clearColumn(componentTicks.added, lastIdx, archetype.capacity);
    clearColumn(componentTicks.changed, lastIdx, archetype.capacity);
  }

  return swappedEntityId;
}

/**
 * Transfers an entity between archetypes, copying shared data and revision stamps.
 * Used when adding/removing components causes an entity to move archetypes.
 *
 * @param fromArchetype - Source archetype
 * @param fromRow - Row index in source archetype
 * @param toArchetype - Target archetype
 * @param revision - Current world revision for new component stamps (defaults to 0)
 * @returns New row index and swapped entity ID (if any was moved during removal)
 *
 * @example
 * ```ts
 * const { toRow, swappedEntityId } = transferEntityToArchetypeByRow(
 *   fromArchetype, fromRow, toArchetype, world.revision
 * );
 * ```
 */
export function transferEntityToArchetypeByRow(
  fromArchetype: Archetype,
  fromRow: number,
  toArchetype: Archetype,
  revision = 0
): { toRow: number; swappedEntityId: EntityId | undefined } {
  const entityId = fromArchetype.entities[fromRow]!;
  const toRow = addEntityToArchetype(toArchetype, entityId, revision);

  for (let t = 0; t < toArchetype.types.length; t++) {
    const type = toArchetype.types[t]!;
    const destFieldColumns = toArchetype.columns.get(type);
    const sourceFieldColumns = fromArchetype.columns.get(type);

    if (destFieldColumns && sourceFieldColumns) {
      for (const fieldName in destFieldColumns) {
        const destColumn = destFieldColumns[fieldName]!;
        const stride = getColumnStride(destColumn, toArchetype.capacity);
        copyColumnSlot(destColumn, toRow, sourceFieldColumns[fieldName]!, fromRow, stride);
      }
    }

    const fromTicks = fromArchetype.ticks.get(type);
    const toTicks = toArchetype.ticks.get(type);

    if (fromTicks && toTicks) {
      toTicks.added[toRow] = fromTicks.added[fromRow]!;
      toTicks.changed[toRow] = fromTicks.changed[fromRow]!;
    }
  }

  const swappedEntityId = removeEntityFromArchetypeByRow(fromArchetype, fromRow);
  return { toRow, swappedEntityId };
}

// ============================================================================
// Archetype Graph Traversal
// ============================================================================

/**
 * Finds insertion index in sorted array using binary search.
 */
function findInsertionIndex(types: EntityId[], typeId: EntityId): number {
  let low = 0;
  let high = types.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (types[mid]! < typeId) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

/**
 * Finds or creates the archetype for an already-computed type set, checking the world
 * lookup first to avoid allocating a schema Map for an archetype that exists.
 *
 * A `schema` of undefined means `typeId` carries no data (tag or wildcard pair), so the
 * entry is dropped -- correct for both traversal directions.
 */
function ensureArchetype(
  world: World,
  from: Archetype,
  typeId: EntityId,
  newTypes: EntityId[],
  schema?: SchemaRecord
): Archetype {
  const existing = world.archetypes.byId.get(hashArchetypeTypes(newTypes));

  if (existing) {
    return existing;
  }

  const schemas = new Map(from.schemas);

  if (schema) {
    schemas.set(typeId, schema);
  } else {
    schemas.delete(typeId);
  }

  return createAndRegisterArchetype(world, newTypes, schemas);
}

/**
 * Records the edge between two archetypes in both directions.
 * Bidirectional edges enable O(1) traversal in both add and remove directions.
 */
function linkArchetypes(from: Archetype, to: Archetype, typeId: EntityId): Archetype {
  from.edges.set(typeId, to);
  to.edges.set(typeId, from);

  return to;
}

/**
 * Destroys an archetype and cleans up all references.
 * Removes from world lookup, fires observer event, and clears bidirectional edges.
 *
 * @param world - World containing the archetype
 * @param archetype - Archetype to destroy (root archetype is protected)
 *
 * @example
 * ```ts
 * if (archetype.entities.length === 0) {
 *   destroyArchetype(world, archetype);
 * }
 * ```
 */
export function destroyArchetype(world: World, archetype: Archetype): void {
  if (archetype === world.archetypes.root) {
    return;
  }

  removeEntityRecord(world, archetype);
  fireObserverEvent(world, "archetypeDestroyed", archetype);
  world.archetypes.byId.delete(archetype.hash);

  for (const [typeId, targetArchetype] of archetype.edges) {
    targetArchetype.edges.delete(typeId);
  }
}

/**
 * Traverses the archetype graph to find or create an archetype with a type added.
 * Uses edge caching for O(1) repeated traversals.
 *
 * @param world - World containing archetype graph
 * @param from - Starting archetype
 * @param typeId - Type ID to add
 * @param schema - Schema for the type (required if type is new to graph)
 * @returns Archetype with the type added, or same archetype if type already present
 *
 * @example
 * ```ts
 * const newArchetype = archetypeTraverseAdd(world, archetype, velocityId, velocitySchema);
 * ```
 */
export function archetypeTraverseAdd(
  world: World,
  from: Archetype,
  typeId: EntityId,
  schema?: SchemaRecord
): Archetype {
  if (from.typesSet.has(typeId)) {
    return from;
  }

  const cachedArchetype = from.edges.get(typeId);

  if (cachedArchetype) {
    return cachedArchetype;
  }

  const newTypes = from.types.toSpliced(findInsertionIndex(from.types, typeId), 0, typeId);

  return linkArchetypes(from, ensureArchetype(world, from, typeId, newTypes, schema), typeId);
}

/**
 * Traverses the archetype graph to find or create an archetype with a type removed.
 * Uses edge caching for O(1) repeated traversals.
 *
 * @param world - World containing archetype graph
 * @param from - Starting archetype
 * @param typeId - Type ID to remove
 * @returns Archetype with the type removed, or same archetype if type not present
 *
 * @example
 * ```ts
 * const newArchetype = archetypeTraverseRemove(world, archetype, velocityId);
 * ```
 */
export function archetypeTraverseRemove(world: World, from: Archetype, typeId: EntityId): Archetype {
  if (!from.typesSet.has(typeId)) {
    return from;
  }

  const cachedArchetype = from.edges.get(typeId);

  if (cachedArchetype) {
    return cachedArchetype;
  }

  const newTypes = from.types.filter((id) => id !== typeId);

  return linkArchetypes(from, ensureArchetype(world, from, typeId, newTypes), typeId);
}
