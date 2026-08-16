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
 * Backing store for one field across all rows: a TypedArray for numeric
 * fields, a plain array for reference values.
 * @internal
 */
export type Column = Int8Array | Int16Array | Int32Array | Uint32Array | Float32Array | Float64Array | unknown[];

/**
 * Field name -> storage column, for a single component.
 * @internal
 */
export type FieldColumns = {
  [fieldName: string]: Column;
};

/**
 * Typed array storage with narrowed numeric indexed access.
 */
type NarrowedTypedArray<T extends number> = TypedArrayInstance & { [index: number]: T };

/**
 * Maps an inferred scalar value type to its column storage type.
 */
type FieldColumnOf<T> = [T] extends [number] ? NarrowedTypedArray<T & number> : T[];

/**
 * Maps a schema record to the column type backing each field.
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
 * Per-component change-detection stamps, parallel to the archetype's rows.
 * @internal
 */
export type ComponentTicks = {
  /** World revision at which each row's entity gained the component. */
  added: Float64Array;
  /** World revision of the last write to each row (also stamped on add). */
  changed: Float64Array;
  /** At least as high as every `added` stamp below; lets change queries skip untouched archetypes. */
  maxAdded: number;
  /** At least as high as every `changed` stamp below; lets change queries skip untouched archetypes. */
  maxChanged: number;
};

// ============================================================================
// Archetype Type
// ============================================================================

/**
 * Columnar storage for all entities sharing one exact component set.
 * @internal
 */
export type Archetype = {
  /** Component type IDs in ascending order. */
  types: EntityId[];
  /** Set view of `types` for O(1) membership checks. */
  typesSet: Set<EntityId>;
  /** Colon-joined `types`; the key in the world's archetype registry. */
  hash: string;
  /** Dense entity list; the index is the entity's row in every column. */
  entities: EntityId[];
  /** Data columns per data-bearing type; empty until the first entity (lazy allocation). */
  columns: Map<EntityId, FieldColumns>;
  /** Field schemas per data-bearing type, used to allocate columns. */
  schemas: Map<EntityId, SchemaRecord>;
  /** Transition graph: type ID -> the neighbor differing by exactly that type, linked both ways. */
  edges: Map<EntityId, Archetype>;
  /** Allocated rows in every column; 0 until the first entity. */
  capacity: number;
  /** Change-detection stamps per type, parallel to `entities`. */
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
 */
function getColumnStride(column: Column, capacity: number): number {
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

/**
 * Looks up the column backing one field of a component on an archetype.
 * Undefined covers both missing component and missing field -- the field
 * accessors treat them identically as "not present".
 */
function resolveColumn(archetype: Archetype, componentId: EntityId, fieldName: string): Column | undefined {
  return archetype.columns.get(componentId)?.[fieldName];
}

/**
 * Copies one row's vector elements out of a column into a fresh array.
 */
function readVectorSlot(column: Column, row: number, capacity: number): unknown[] {
  const stride = getColumnStride(column, capacity);
  const offset = row * stride;
  const result = [];

  for (let i = 0; i < stride; i++) {
    result[i] = column[offset + i];
  }

  return result;
}

/**
 * Writes an array of vector elements into one row of a column.
 */
function writeVectorSlot(column: Column, row: number, capacity: number, value: number[]): void {
  const stride = getColumnStride(column, capacity);
  const offset = row * stride;

  for (let i = 0; i < stride; i++) {
    column[offset + i] = value[i]!;
  }
}

/**
 * Returns a zero-copy subarray view of one row's vector elements.
 */
function viewVectorSlot(column: Exclude<Column, unknown[]>, row: number, capacity: number): TypedArrayInstance {
  const stride = getColumnStride(column, capacity);
  const offset = row * stride;

  return column.subarray(offset, offset + stride) as TypedArrayInstance;
}

// ============================================================================
// Hashing
// ============================================================================

/**
 * Joins sorted type IDs into the archetype registry key (e.g. "1:5:12").
 * @internal
 */
export function hashArchetypeTypes(types: EntityId[]): string {
  return types.join(":");
}

// ============================================================================
// Archetype Creation
// ============================================================================

/**
 * Creates an archetype from sorted type IDs and their schemas. Columns
 * allocate lazily on first entity insertion so transitional graph nodes
 * cost no memory.
 * @internal
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
 * Adds an archetype to the world registry and each type's entity records,
 * then fires `archetypeCreated` so filter caches pick it up.
 * @internal
 */
export function registerArchetype(world: World, archetype: Archetype): void {
  world.archetypes.byId.set(archetype.hash, archetype);
  addEntityRecord(world, archetype);
  fireObserverEvent(world, "archetypeCreated", archetype);
}

/**
 * Creates an archetype and registers it in the world in one step.
 * @internal
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
 * @internal
 */
export type ArchetypeState = {
  /** Root archetype (empty - no components). */
  root: Archetype;
  /** Archetype lookup by hash key (hash -> archetype). */
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

  // First entity: allocate all data and tick columns at the initial capacity
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
        maxAdded: 0,
        maxChanged: 0,
      });
    }

    archetype.capacity = initialCapacity;
    return;
  }

  // Growth: quadruple until the requirement fits, then resize every column
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
// Tick Stamping
// ============================================================================

/**
 * Stamps a row's added tick and lifts `maxAdded`.
 */
function stampAddedTick(ticks: ComponentTicks, row: number, revision: number): void {
  ticks.added[row] = revision;

  if (revision > ticks.maxAdded) {
    ticks.maxAdded = revision;
  }
}

/**
 * Stamps a row's changed tick and lifts `maxChanged`.
 */
function stampChangedTick(ticks: ComponentTicks, row: number, revision: number): void {
  ticks.changed[row] = revision;

  if (revision > ticks.maxChanged) {
    ticks.maxChanged = revision;
  }
}

/**
 * Stamps a component's changed tick on an archetype row, feeding `changed()`
 * queries. No-op when the type has no tick columns (type absent, or nothing
 * allocated yet). The sole changed-tick entry point for other modules.
 * @internal
 */
export function stampComponentChanged(
  archetype: Archetype,
  componentId: EntityId,
  row: number,
  revision: number
): void {
  const ticks = archetype.ticks.get(componentId);

  if (ticks) {
    stampChangedTick(ticks, row, revision);
  }
}

// ============================================================================
// Field Access
// ============================================================================

/**
 * Reads one row's scalar field value. Undefined when the component or field
 * is absent.
 * @internal
 */
export function readField(archetype: Archetype, componentId: EntityId, fieldName: string, row: number): unknown {
  return resolveColumn(archetype, componentId, fieldName)?.[row];
}

/**
 * Writes one row's scalar field value and stamps the changed tick. Returns
 * false without writing when the component or field is absent.
 * @internal
 */
export function writeField(
  archetype: Archetype,
  componentId: EntityId,
  fieldName: string,
  row: number,
  value: unknown,
  revision: number
): boolean {
  const column = resolveColumn(archetype, componentId, fieldName);

  if (!column) {
    return false;
  }

  column[row] = value;
  stampComponentChanged(archetype, componentId, row, revision);

  return true;
}

/**
 * Reads one row's vector field as a fresh array. Undefined when the component
 * or field is absent.
 * @internal
 */
export function readVectorField(
  archetype: Archetype,
  componentId: EntityId,
  fieldName: string,
  row: number
): unknown[] | undefined {
  const column = resolveColumn(archetype, componentId, fieldName);

  if (!column) {
    return;
  }

  return readVectorSlot(column, row, archetype.capacity);
}

/**
 * Writes one row's vector field from an array and stamps the changed tick.
 * Returns false without writing when the component or field is absent.
 * @internal
 */
export function writeVectorField(
  archetype: Archetype,
  componentId: EntityId,
  fieldName: string,
  row: number,
  value: number[],
  revision: number
): boolean {
  const column = resolveColumn(archetype, componentId, fieldName);

  if (!column) {
    return false;
  }

  writeVectorSlot(column, row, archetype.capacity, value);
  stampComponentChanged(archetype, componentId, row, revision);

  return true;
}

/**
 * Returns a zero-copy view of one row's vector field. Undefined when the
 * component or field is absent or the field is not typed-array backed.
 * @internal
 */
export function viewVectorField(
  archetype: Archetype,
  componentId: EntityId,
  fieldName: string,
  row: number
): TypedArrayInstance | undefined {
  const column = resolveColumn(archetype, componentId, fieldName);

  if (!column || Array.isArray(column)) {
    return;
  }

  return viewVectorSlot(column, row, archetype.capacity);
}

// ============================================================================
// Component Data Writes
// ============================================================================

/**
 * Writes a record of field values into a component's columns at one row and
 * stamps the changed tick. Returns false without writing when the type stores
 * nothing (tag, or columns not allocated); unknown fields are skipped.
 * @internal
 */
export function writeComponentColumns(
  archetype: Archetype,
  row: number,
  componentId: EntityId,
  data: Record<string, unknown>,
  revision: number
): boolean {
  const fieldColumns = archetype.columns.get(componentId);

  if (!fieldColumns) {
    return false;
  }

  for (const fieldName in data) {
    const column = fieldColumns[fieldName];

    if (!column) {
      continue;
    }

    const value = data[fieldName];
    const stride = getColumnStride(column, archetype.capacity);

    if (stride === 1) {
      column[row] = value;
    } else {
      writeVectorSlot(column, row, archetype.capacity, value as number[]);
    }
  }

  stampComponentChanged(archetype, componentId, row, revision);

  return true;
}

// ============================================================================
// Entity Movement
// ============================================================================

/**
 * Appends an entity to an archetype and returns its row, stamping every
 * type's added/changed ticks with `revision`.
 * @internal
 */
export function addEntityToArchetype(archetype: Archetype, entityId: EntityId, revision = 0): number {
  const row = archetype.entities.length;
  ensureArchetypeCapacity(archetype, row + 1);
  archetype.entities.push(entityId);

  for (const componentTicks of archetype.ticks.values()) {
    stampAddedTick(componentTicks, row, revision);
    stampChangedTick(componentTicks, row, revision);
  }

  return row;
}

/**
 * Removes a row via swap-and-pop, returning the entity moved into it (or
 * undefined if the row was last). The caller must update the swapped
 * entity's row metadata.
 * @internal
 */
export function removeEntityFromArchetypeByRow(archetype: Archetype, row: number): EntityId | undefined {
  const lastIdx = archetype.entities.length - 1;
  let swappedEntityId: EntityId | undefined;

  // Swap: copy the last row's entity, column data, and tick stamps into the vacated slot
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
      stampAddedTick(componentTicks, row, componentTicks.added[lastIdx]!);
      stampChangedTick(componentTicks, row, componentTicks.changed[lastIdx]!);
    }
  }

  archetype.entities.pop();

  // Clear the vacated last slot so reference columns release their objects
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
 * Moves an entity between archetypes: shared types keep their data and tick
 * stamps, new types stamp at `revision`. Returns the destination row and any
 * entity swapped into the vacated source row (caller updates its metadata).
 * @internal
 */
export function transferEntityToArchetypeByRow(
  fromArchetype: Archetype,
  fromRow: number,
  toArchetype: Archetype,
  revision = 0
): { toRow: number; swappedEntityId: EntityId | undefined } {
  const entityId = fromArchetype.entities[fromRow]!;
  const toRow = addEntityToArchetype(toArchetype, entityId, revision);

  // Copy data and tick stamps for every type both archetypes share
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
      stampAddedTick(toTicks, toRow, fromTicks.added[fromRow]!);
      stampChangedTick(toTicks, toRow, fromTicks.changed[fromRow]!);
    }
  }

  // Vacate the source row last so the copy above reads intact data
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
 * Unregisters an archetype, fires `archetypeDestroyed`, and severs its graph
 * edges from both sides. No-op for the root archetype.
 * @internal
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
 * Follows or creates the graph edge to the archetype with `typeId` added,
 * returning `from` unchanged when the type is already present. Cached edges
 * make repeated transitions O(1).
 * @internal
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
 * Follows or creates the graph edge to the archetype with `typeId` removed,
 * returning `from` unchanged when the type is absent. Cached edges make
 * repeated transitions O(1).
 * @internal
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
