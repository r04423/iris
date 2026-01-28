import type { EntityId } from "./encoding.js";
import { addEntityRecord, removeEntityRecord } from "./entity.js";
import { fireObserverEvent } from "./observer.js";
import type { Schema, SchemaRecord, TypedArrayConstructor } from "./schema.js";
import { Type } from "./schema.js";
import type { World } from "./world.js";

// ============================================================================
// Column Storage Types
// ============================================================================

/**
 * Column storage type.
 *
 * Union of typed arrays (numeric values) and regular arrays (primitives/objects).
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
 * Component tick storage for change detection.
 *
 * Parallel arrays to entity rows tracking when components were added/changed.
 */
export type ComponentTicks = {
  added: Uint32Array;
  changed: Uint32Array;
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
 * Schema for tick columns (Uint32Array).
 */
const TICK_SCHEMA = Type.u32();

// ============================================================================
// Column Utilities
// ============================================================================

/**
 * Allocates a column based on schema type (TypedArray for primitives, Array for objects).
 */
function allocateColumn(schema: Schema, capacity: number): Column {
  if (schema.kind === "typed") {
    const TypedArrayCtor = schema.arrayConstructor as TypedArrayConstructor;
    return new TypedArrayCtor(capacity);
  }
  return [];
}

/**
 * Resizes a column to new capacity, preserving existing data. Regular arrays need no resize.
 */
function resizeColumn(column: Column, newCapacity: number): Column {
  if (Array.isArray(column)) {
    return column;
  }

  const TypedArrayCtor = column.constructor as TypedArrayConstructor;
  const newColumn = new TypedArrayCtor(newCapacity);
  const copyLength = Math.min(column.length, newCapacity);
  newColumn.set(column.subarray(0, copyLength));

  return newColumn;
}

/**
 * Clears a column slot (undefined for arrays, 0 for typed arrays).
 */
function clearColumn(column: Column, index: number): void {
  if (Array.isArray(column)) {
    column[index] = undefined;
  } else {
    column[index] = 0;
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
// Capacity Management
// ============================================================================

/**
 * Ensures archetype has capacity for requiredCapacity entities.
 * Allocates columns and tick arrays on first entity, grows 4x thereafter.
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
        added: allocateColumn(TICK_SCHEMA, initialCapacity) as Uint32Array,
        changed: allocateColumn(TICK_SCHEMA, initialCapacity) as Uint32Array,
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
      fieldColumns[fieldName] = resizeColumn(fieldColumns[fieldName]!, newCapacity);
    }
  }

  for (const componentTicks of archetype.ticks.values()) {
    componentTicks.added = resizeColumn(componentTicks.added, newCapacity) as Uint32Array;
    componentTicks.changed = resizeColumn(componentTicks.changed, newCapacity) as Uint32Array;
  }

  archetype.capacity = newCapacity;
}

// ============================================================================
// Entity Movement
// ============================================================================

/**
 * Adds an entity to an archetype, initializing tick tracking for change detection.
 *
 * @param archetype - Target archetype
 * @param entityId - Entity to add
 * @param tick - Current world tick for change detection (defaults to 0)
 * @returns Row index where entity was inserted
 *
 * @example
 * ```ts
 * const row = addEntityToArchetype(archetype, entityId, world.tick);
 * ```
 */
export function addEntityToArchetype(archetype: Archetype, entityId: EntityId, tick = 0): number {
  const row = archetype.entities.length;
  ensureArchetypeCapacity(archetype, row + 1);
  archetype.entities.push(entityId);

  for (const componentTicks of archetype.ticks.values()) {
    componentTicks.added[row] = tick;
    componentTicks.changed[row] = tick;
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
        fieldColumns[fieldName]![row] = fieldColumns[fieldName]![lastIdx];
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
      clearColumn(fieldColumns[fieldName]!, lastIdx);
    }
  }

  for (const componentTicks of archetype.ticks.values()) {
    clearColumn(componentTicks.added, lastIdx);
    clearColumn(componentTicks.changed, lastIdx);
  }

  return swappedEntityId;
}

/**
 * Transfers an entity between archetypes, copying shared component data and ticks.
 * Used when adding/removing components causes an entity to move archetypes.
 *
 * @param fromArchetype - Source archetype
 * @param fromRow - Row index in source archetype
 * @param toArchetype - Target archetype
 * @param tick - Current world tick for new component ticks (defaults to 0)
 * @returns New row index and swapped entity ID (if any was moved during removal)
 *
 * @example
 * ```ts
 * const { toRow, swappedEntityId } = transferEntityToArchetypeByRow(
 *   fromArchetype, fromRow, toArchetype, world.tick
 * );
 * ```
 */
export function transferEntityToArchetypeByRow(
  fromArchetype: Archetype,
  fromRow: number,
  toArchetype: Archetype,
  tick = 0
): { toRow: number; swappedEntityId: EntityId | undefined } {
  const entityId = fromArchetype.entities[fromRow]!;
  const toRow = addEntityToArchetype(toArchetype, entityId, tick);

  for (let t = 0; t < toArchetype.types.length; t++) {
    const type = toArchetype.types[t]!;
    const destFieldColumns = toArchetype.columns.get(type);
    const sourceFieldColumns = fromArchetype.columns.get(type);

    if (!destFieldColumns || !sourceFieldColumns) continue;

    for (const fieldName in destFieldColumns) {
      destFieldColumns[fieldName]![toRow] = sourceFieldColumns[fieldName]![fromRow];
    }
  }

  for (const componentId of toArchetype.types) {
    const fromTicks = fromArchetype.ticks.get(componentId);
    const toTicks = toArchetype.ticks.get(componentId);

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
 * Finds or creates an archetype with a type added, checking cache first to avoid Map allocation.
 */
function ensureArchetypeWithType(world: World, from: Archetype, typeId: EntityId, schema?: SchemaRecord): Archetype {
  const insertIdx = findInsertionIndex(from.types, typeId);
  const newTypes = from.types.toSpliced(insertIdx, 0, typeId);

  const hashKey = hashArchetypeTypes(newTypes);
  const existing = world.archetypes.byId.get(hashKey);
  if (existing) return existing;

  const schemas = new Map(from.schemas);
  if (schema) schemas.set(typeId, schema);

  return createAndRegisterArchetype(world, newTypes, schemas);
}

/**
 * Finds or creates an archetype with a type removed, checking cache first to avoid Map allocation.
 */
function ensureArchetypeWithoutType(world: World, from: Archetype, typeId: EntityId): Archetype {
  const newTypes = from.types.filter((id) => id !== typeId);

  const hashKey = hashArchetypeTypes(newTypes);
  const existing = world.archetypes.byId.get(hashKey);
  if (existing) return existing;

  const schemas = new Map(from.schemas);
  schemas.delete(typeId);

  return createAndRegisterArchetype(world, newTypes, schemas);
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
  if (archetype === world.archetypes.root) return;

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
  if (from.typesSet.has(typeId)) return from;

  const cachedArchetype = from.edges.get(typeId);
  if (cachedArchetype) return cachedArchetype;

  const to = ensureArchetypeWithType(world, from, typeId, schema);

  // Bidirectional edges enable O(1) traversal in both add and remove directions
  from.edges.set(typeId, to);
  to.edges.set(typeId, from);

  return to;
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
  if (!from.typesSet.has(typeId)) return from;

  const cachedArchetype = from.edges.get(typeId);
  if (cachedArchetype) return cachedArchetype;

  const to = ensureArchetypeWithoutType(world, from, typeId);

  // Bidirectional edges enable O(1) traversal in both add and remove directions
  from.edges.set(typeId, to);
  to.edges.set(typeId, from);

  return to;
}
