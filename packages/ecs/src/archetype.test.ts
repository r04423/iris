import assert from "node:assert";
import { describe, it } from "node:test";
import {
  addEntityToArchetype,
  archetypeTraverseAdd,
  archetypeTraverseRemove,
  createAndRegisterArchetype,
  createArchetype,
  destroyArchetype,
  hashArchetypeTypes,
  registerArchetype,
  removeEntityFromArchetypeByRow,
  transferEntityToArchetypeByRow,
} from "./archetype.js";
import { addComponent, removeComponent } from "./component.js";
import type { EntityId } from "./encoding.js";
import { createEntity, destroyEntity, isEntityAlive } from "./entity.js";
import { defineComponent } from "./registry.js";
import { Type } from "./schema.js";
import { createWorld } from "./world.js";

describe("Archetype", () => {
  // ============================================================================
  // Hashing
  // ============================================================================

  describe("Archetype Hashing", () => {
    it("hashes sorted component IDs with colon separator", () => {
      const types = [1, 5, 12] as EntityId[];
      const hashKey = hashArchetypeTypes(types);

      assert.strictEqual(hashKey, "1:5:12");
    });

    it("produces consistent hash for same component IDs", () => {
      const types1 = [1, 2, 3] as EntityId[];
      const types2 = [1, 2, 3] as EntityId[];

      assert.strictEqual(hashArchetypeTypes(types1), hashArchetypeTypes(types2));
    });

    it("produces different hash for different component IDs", () => {
      const types1 = [1, 2, 3] as EntityId[];
      const types2 = [1, 2, 4] as EntityId[];

      assert.notStrictEqual(hashArchetypeTypes(types1), hashArchetypeTypes(types2));
    });

    it("handles empty component array", () => {
      const types: EntityId[] = [];
      const hashKey = hashArchetypeTypes(types);

      assert.strictEqual(hashKey, "");
    });

    it("handles single component", () => {
      const types = [42] as EntityId[];
      const hashKey = hashArchetypeTypes(types);

      assert.strictEqual(hashKey, "42");
    });
  });

  // ============================================================================
  // Archetype Creation
  // ============================================================================

  describe("Archetype Creation", () => {
    it("creates archetype with hash identity", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const types = [positionId];
      const schemas = new Map([[positionId, { x: Type.f32(), y: Type.f32() }]]);

      const archetype = createArchetype(types, schemas);

      assert.deepStrictEqual(archetype.types, [positionId]);
      assert.ok(archetype.typesSet.has(positionId));
      assert.ok(archetype.edges instanceof Map);
      assert.strictEqual(archetype.edges.size, 0);
    });

    it("creates typesSet for O(1) component lookup", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);
      const types = [positionId, velocityId];

      const archetype = createArchetype(types, new Map());

      assert.ok(archetype.typesSet instanceof Set);
      assert.strictEqual(archetype.typesSet.size, 2);
      assert.ok(archetype.typesSet.has(positionId));
      assert.ok(archetype.typesSet.has(velocityId));
    });

    it("initializes empty edges map", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const types = [positionId];

      const archetype = createArchetype(types, new Map());

      assert.ok(archetype.edges instanceof Map);
      assert.strictEqual(archetype.edges.size, 0);
    });

    it("allocates columns and ticks lazily on first entity insertion", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);
      const types = [positionId, velocityId];

      const schemas = new Map();
      schemas.set(positionId, { x: Type.f32(), y: Type.f32() });
      schemas.set(velocityId, { dx: Type.f32(), dy: Type.f32() });

      const archetype = createArchetype(types, schemas);

      // Before entity: capacity 0, no columns or ticks allocated
      assert.strictEqual(archetype.capacity, 0);
      assert.strictEqual(archetype.columns.size, 0);
      assert.strictEqual(archetype.ticks.size, 0);
      // Schemas retained for lazy allocation
      assert.strictEqual(archetype.schemas.size, 2);

      // Add entity triggers allocation
      const entityId = createEntity(world);
      const tick = 42;
      const row = addEntityToArchetype(archetype, entityId, tick);

      // After entity: columns and ticks allocated
      assert.ok(archetype.capacity > 0);
      assert.strictEqual(archetype.columns.size, 2);
      assert.strictEqual(archetype.ticks.size, 2);
      const posColumns = archetype.columns.get(positionId);
      const velColumns = archetype.columns.get(velocityId);
      assert.ok(posColumns);
      assert.ok(velColumns);
      assert.strictEqual(Object.keys(posColumns).length, 2);
      assert.strictEqual(Object.keys(velColumns).length, 2);

      // Ticks initialized with provided value
      const posTicks = archetype.ticks.get(positionId);
      assert.ok(posTicks?.added instanceof Uint32Array);
      assert.strictEqual(posTicks?.added[row], tick);
      assert.strictEqual(posTicks?.changed[row], tick);
    });

    it("creates archetype with no columns for tag components", () => {
      const world = createWorld();
      const tagId = createEntity(world);
      const types = [tagId];

      // Tags don't appear in schemas map - they just don't get columns
      const archetype = createArchetype(types, new Map());

      assert.strictEqual(archetype.columns.size, 0);
      assert.deepStrictEqual(archetype.types, [tagId]);
    });

    it("resizes archetype with object schema fields (regular arrays)", () => {
      const world = createWorld();
      const componentId = createEntity(world);

      // Use object schema field which allocates regular Array (not TypedArray)
      const schemas = new Map([[componentId, { data: Type.object<{ value: number }>() }]]);
      const archetype = createArchetype([componentId], schemas);

      // Initial capacity is 16, need to add > 16 entities to trigger resize
      // Then add > 64 to trigger a second resize (capacity grows 4x each time)
      const entities: number[] = [];
      for (let i = 0; i < 20; i++) {
        const e = createEntity(world);
        const row = addEntityToArchetype(archetype, e);
        entities.push(e);

        // Set data value to verify preservation
        const dataColumn = archetype.columns.get(componentId)?.data;
        if (dataColumn && Array.isArray(dataColumn)) {
          dataColumn[row] = { value: i };
        }
      }

      // Verify capacity grew beyond initial 16
      assert.ok(archetype.capacity >= 20);

      // Verify data is preserved after resize
      const dataColumn = archetype.columns.get(componentId)?.data;
      assert.ok(Array.isArray(dataColumn));
      for (let i = 0; i < 20; i++) {
        assert.strictEqual((dataColumn as { value: number }[])[i]?.value, i);
      }
    });

    it("creates archetype with mixed data components and tags", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const tagId = createEntity(world);
      const types = [positionId, tagId];

      // Only position has schema (tag has no columns)
      const archetype = createArchetype(types, new Map([[positionId, { x: Type.f32(), y: Type.f32() }]]));

      // Before entity: capacity 0, schemas retained
      assert.strictEqual(archetype.capacity, 0);
      assert.strictEqual(archetype.schemas.size, 1);
      assert.deepStrictEqual(archetype.types, [positionId, tagId]);

      // Add entity triggers allocation
      const entityId = createEntity(world);
      addEntityToArchetype(archetype, entityId);

      // After entity: columns for position only (tag has no columns)
      assert.strictEqual(archetype.columns.size, 1);
      const posColumns = archetype.columns.get(positionId);
      assert.ok(posColumns);
      assert.strictEqual(Object.keys(posColumns).length, 2);
    });

    it("stores hash key as archetype identity", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);
      const types = [positionId, velocityId];

      const archetype = createArchetype(types, new Map());

      // Hash should match the sorted entity IDs
      const expectedHash = `${positionId}:${velocityId}`;
      assert.strictEqual(archetype.hash, expectedHash);
    });

    it("uses types as-is (caller must provide sorted)", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);

      // Contract: caller provides pre-sorted types (ascending order)
      const sortedTypes = [positionId, velocityId].toSorted((a, b) => a - b);
      const archetype = createArchetype(sortedTypes, new Map());

      // Types stored exactly as provided
      assert.deepStrictEqual(archetype.types, sortedTypes);
      assert.strictEqual(archetype.hash, `${sortedTypes[0]}:${sortedTypes[1]}`);
    });
  });

  // ============================================================================
  // Column Access
  // ============================================================================

  describe("Component Column Lookup", () => {
    it("retrieves column for component field after entity insertion", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const types = [positionId];

      const archetype = createArchetype(types, new Map([[positionId, { x: Type.f32(), y: Type.f32() }]]));

      // Add entity to trigger column allocation
      const entityId = createEntity(world);
      addEntityToArchetype(archetype, entityId);

      const xColumn = archetype.columns.get(positionId)?.x;
      const yColumn = archetype.columns.get(positionId)?.y;

      assert.ok(xColumn instanceof Float32Array);
      assert.ok(yColumn instanceof Float32Array);
    });

    it("returns undefined for non-existent component", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);
      const types = [positionId];

      const archetype = createArchetype(types, new Map([[positionId, { x: Type.f32() }]]));

      // Even after entity insertion, velocityId has no columns
      const entityId = createEntity(world);
      addEntityToArchetype(archetype, entityId);

      const column = archetype.columns.get(velocityId)?.dx;

      assert.strictEqual(column, undefined);
    });

    it("returns undefined for non-existent field", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const types = [positionId];

      const archetype = createArchetype(types, new Map([[positionId, { x: Type.f32(), y: Type.f32() }]]));

      // Add entity to trigger column allocation
      const entityId = createEntity(world);
      addEntityToArchetype(archetype, entityId);

      const column = archetype.columns.get(positionId)?.z;

      assert.strictEqual(column, undefined);
    });

    it("returns undefined for tag component (no columns)", () => {
      const world = createWorld();
      const tagId = createEntity(world);
      const types = [tagId];

      const archetype = createArchetype(types, new Map());

      // Even after entity insertion, tags have no columns
      const entityId = createEntity(world);
      addEntityToArchetype(archetype, entityId);

      const column = archetype.columns.get(tagId)?.anyField;

      assert.strictEqual(column, undefined);
    });

    it("retrieves different columns for different fields", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const types = [positionId];

      const archetype = createArchetype(types, new Map([[positionId, { x: Type.f32(), y: Type.f32() }]]));

      // Add entity to trigger column allocation
      const entityId = createEntity(world);
      addEntityToArchetype(archetype, entityId);

      const xColumn = archetype.columns.get(positionId)?.x;
      const yColumn = archetype.columns.get(positionId)?.y;

      // Different columns (different array instances)
      assert.notStrictEqual(xColumn, yColumn);
    });
  });

  // ============================================================================
  // Entity Movement
  // ============================================================================

  describe("Entity Movement", () => {
    it("moves entity from one archetype to another", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const archetypeA = createArchetype([positionId], new Map([[positionId, { x: Type.f32(), y: Type.f32() }]]));

      const velocityId = createEntity(world);
      const archetypeB = createArchetype([velocityId], new Map([[velocityId, { dx: Type.f32(), dy: Type.f32() }]]));

      createEntity(world);

      // Root has: [positionId, velocityId, and the entity we just created]
      // Move the third entity from root to archetype A first
      transferEntityToArchetypeByRow(world.archetypes.root, 2, archetypeA);

      // Move entity from A to B
      transferEntityToArchetypeByRow(archetypeA, 0, archetypeB);

      // Entity should be removed from A
      assert.strictEqual(archetypeA.entities.length, 0);

      // Root should have 2 entities left (positionId, velocityId)
      assert.strictEqual(world.archetypes.root.entities.length, 2);

      // Entity should be added to B
      assert.strictEqual(archetypeB.entities.length, 1);
    });

    it("copies shared component data during movement", () => {
      const world = createWorld();
      createEntity(world);

      const positionId = createEntity(world);
      // Archetype A: Position only
      const archetypeA = createArchetype([positionId], new Map([[positionId, { x: Type.f32(), y: Type.f32() }]]));

      const velocityId = createEntity(world);
      // Archetype B: Position + Velocity
      const schemasB = new Map();
      schemasB.set(positionId, { x: Type.f32(), y: Type.f32() });
      schemasB.set(velocityId, { dx: Type.f32(), dy: Type.f32() });

      const archetypeB = createArchetype([positionId, velocityId], schemasB);

      // Move entity from root to archetype A
      const { toRow: toRowA } = transferEntityToArchetypeByRow(world.archetypes.root, 0, archetypeA);

      // Set position data in archetype A
      const xColumnA = archetypeA.columns.get(positionId)?.x;
      const yColumnA = archetypeA.columns.get(positionId)?.y;
      if (xColumnA && yColumnA) {
        xColumnA[toRowA] = 10.5;
        yColumnA[toRowA] = 20.5;
      }

      // Move entity from A to B
      transferEntityToArchetypeByRow(archetypeA, toRowA, archetypeB);

      // Position data should be copied
      const xColumnB = archetypeB.columns.get(positionId)?.x;
      const yColumnB = archetypeB.columns.get(positionId)?.y;
      assert.strictEqual(xColumnB?.[0], 10.5);
      assert.strictEqual(yColumnB?.[0], 20.5);

      // Velocity data should be zeroed (new component)
      const dxColumn = archetypeB.columns.get(velocityId)?.dx;
      const dyColumn = archetypeB.columns.get(velocityId)?.dy;
      assert.strictEqual(dxColumn?.[0], 0);
      assert.strictEqual(dyColumn?.[0], 0);
    });

    it("copies ticks for shared components during transfer", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);

      const archetypeA = createArchetype([positionId], new Map([[positionId, { x: Type.f32() }]]));

      const schemasB = new Map();
      schemasB.set(positionId, { x: Type.f32() });
      schemasB.set(velocityId, { dx: Type.f32() });
      const archetypeB = createArchetype([positionId, velocityId], schemasB);

      // Add entity with specific tick
      const row = addEntityToArchetype(archetypeA, createEntity(world), 15);
      const ticksA = archetypeA.ticks.get(positionId)!;

      // Modify changed tick to differ from added
      ticksA.changed[row] = 25;

      // Transfer to archetype B with new tick 50
      transferEntityToArchetypeByRow(archetypeA, row, archetypeB, 50);

      const ticksB = archetypeB.ticks.get(positionId)!;
      const velTicksB = archetypeB.ticks.get(velocityId)!;

      // Shared component (position) should preserve original ticks
      assert.strictEqual(ticksB.added[0], 15);
      assert.strictEqual(ticksB.changed[0], 25);

      // New component (velocity) should use transfer tick
      assert.strictEqual(velTicksB.added[0], 50);
      assert.strictEqual(velTicksB.changed[0], 50);
    });

    it("preserves ticks during swap-remove", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const archetype = createArchetype([positionId], new Map([[positionId, { x: Type.f32() }]]));

      // Add three entities with different ticks
      const row0 = addEntityToArchetype(archetype, createEntity(world), 10);
      const row1 = addEntityToArchetype(archetype, createEntity(world), 20);
      addEntityToArchetype(archetype, createEntity(world), 30);

      const ticks = archetype.ticks.get(positionId)!;

      // Verify initial state
      assert.strictEqual(ticks.added[row0], 10);
      assert.strictEqual(ticks.added[row1], 20);
      assert.strictEqual(ticks.added[2], 30);

      // Remove middle entity (row1) - last entity should swap into its place
      removeEntityFromArchetypeByRow(archetype, row1);

      // Last entity's tick (30) should now be at row1
      assert.strictEqual(ticks.added[row1], 30);
      // First entity unchanged
      assert.strictEqual(ticks.added[row0], 10);
    });

    it("handles entity movement when component is removed", () => {
      const world = createWorld();
      createEntity(world);

      const positionId = createEntity(world);
      const velocityId = createEntity(world);

      // Archetype A: Position + Velocity
      const schemasA = new Map();
      schemasA.set(positionId, { x: Type.f32(), y: Type.f32() });
      schemasA.set(velocityId, { dx: Type.f32(), dy: Type.f32() });

      const archetypeA = createArchetype([positionId, velocityId], schemasA);

      // Archetype B: Position only
      const archetypeB = createArchetype([positionId], new Map([[positionId, { x: Type.f32(), y: Type.f32() }]]));

      // Move entity from root to archetype A
      const { toRow: rowIdx } = transferEntityToArchetypeByRow(world.archetypes.root, 0, archetypeA);

      // Set component data in archetype A
      const xColumnA = archetypeA.columns.get(positionId)?.x;
      const yColumnA = archetypeA.columns.get(positionId)?.y;
      const dxColumnA = archetypeA.columns.get(velocityId)?.dx;
      const dyColumnA = archetypeA.columns.get(velocityId)?.dy;

      if (xColumnA && yColumnA && dxColumnA && dyColumnA) {
        xColumnA[rowIdx] = 10.5;
        yColumnA[rowIdx] = 20.5;
        dxColumnA[rowIdx] = 1.0;
        dyColumnA[rowIdx] = 2.0;
      }

      // Move entity from A to B (removing velocity)
      transferEntityToArchetypeByRow(archetypeA, rowIdx, archetypeB);

      // Position data should be copied
      const xColumnB = archetypeB.columns.get(positionId)?.x;
      const yColumnB = archetypeB.columns.get(positionId)?.y;
      assert.strictEqual(xColumnB?.[0], 10.5);
      assert.strictEqual(yColumnB?.[0], 20.5);

      // Velocity component shouldn't exist in archetype B
      const dxColumnB = archetypeB.columns.get(velocityId)?.dx;
      assert.strictEqual(dxColumnB, undefined);
    });

    it("handles entity movement from root to custom archetype", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const archetypeA = createArchetype([positionId], new Map([[positionId, { x: Type.f32() }]]));

      createEntity(world);

      // Root should have both positionId and the second entity initially
      assert.strictEqual(world.archetypes.root.entities.length, 2);

      // Move the second entity (index 1) from root to archetype A
      transferEntityToArchetypeByRow(world.archetypes.root, 1, archetypeA);

      // Root should have 1 entity left (positionId)
      assert.strictEqual(world.archetypes.root.entities.length, 1);

      // Archetype A should have the moved entity
      assert.strictEqual(archetypeA.entities.length, 1);
    });

    it("preserves other entities during swap-and-pop removal", () => {
      const world = createWorld();
      createEntity(world);
      createEntity(world);
      createEntity(world);

      const positionId = createEntity(world);
      const archetypeA = createArchetype([positionId], new Map([[positionId, { x: Type.f32() }]]));

      const velocityId = createEntity(world);
      const archetypeB = createArchetype([velocityId], new Map([[velocityId, { dx: Type.f32() }]]));

      // Move all entities from root to archetype A
      const { toRow: row1 } = transferEntityToArchetypeByRow(world.archetypes.root, 0, archetypeA);
      const { toRow: row2 } = transferEntityToArchetypeByRow(world.archetypes.root, 0, archetypeA);
      const { toRow: row3 } = transferEntityToArchetypeByRow(world.archetypes.root, 0, archetypeA);

      const xColumn = archetypeA.columns.get(positionId)?.x;
      if (xColumn) {
        xColumn[row1] = 10.0;
        xColumn[row2] = 20.0;
        xColumn[row3] = 30.0;
      }

      // Move entity2 (middle entity) from A to B
      transferEntityToArchetypeByRow(archetypeA, row2, archetypeB);

      // Archetype A should have 2 entities now
      assert.strictEqual(archetypeA.entities.length, 2);

      // Entity3's data should be swapped into entity2's position (swap-and-pop pattern)
      assert.strictEqual(xColumn?.[row2], 30.0);
    });
  });

  // ============================================================================
  // Archetype Graph Traversal
  // ============================================================================

  describe("Archetype Registry", () => {
    it("registerArchetype adds archetype to world", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);

      const archetype = createArchetype([positionId, velocityId], new Map());
      registerArchetype(world, archetype);

      // Archetype should be registered in world
      const registered = world.archetypes.byId.get(archetype.hash);
      assert.strictEqual(registered, archetype);
    });
  });

  describe("Archetype Traverse Add", () => {
    it("archetypeTraverseAdd creates archetype on first traversal", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);

      const archetypeA = createAndRegisterArchetype(world, [positionId], new Map());
      const archetypeB = archetypeTraverseAdd(world, archetypeA, velocityId);

      // Should create archetype with both components
      assert.deepStrictEqual(archetypeB.types, [positionId, velocityId]);
    });

    it("archetypeTraverseAdd caches forward edge", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);

      const archetypeA = createAndRegisterArchetype(world, [positionId], new Map());
      const archetypeB = archetypeTraverseAdd(world, archetypeA, velocityId);

      // Forward edge should be cached (A + velocity -> B)
      const cachedArchetype = archetypeA.edges.get(velocityId);
      assert.strictEqual(cachedArchetype, archetypeB);
    });

    it("archetypeTraverseAdd caches backward edge", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);

      const archetypeA = createAndRegisterArchetype(world, [positionId], new Map());
      const archetypeB = archetypeTraverseAdd(world, archetypeA, velocityId);

      // Backward edge should be cached (B - velocity -> A)
      const cachedArchetype = archetypeB.edges.get(velocityId);
      assert.strictEqual(cachedArchetype, archetypeA);
    });

    it("archetypeTraverseAdd uses cached edge on second traversal", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);

      const archetypeA = createAndRegisterArchetype(world, [positionId], new Map());

      // First traversal caches edge
      const archetypeB1 = archetypeTraverseAdd(world, archetypeA, velocityId);

      // Second traversal should use cached edge
      const archetypeB2 = archetypeTraverseAdd(world, archetypeA, velocityId);

      // Should return same archetype instance (O(1) lookup)
      assert.strictEqual(archetypeB1, archetypeB2);
    });

    it("archetypeTraverseAdd is idempotent (component already present)", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);

      const archetypeA = createAndRegisterArchetype(world, [positionId, velocityId], new Map());

      // Adding component that already exists
      const archetypeB = archetypeTraverseAdd(world, archetypeA, velocityId);

      // Should return same archetype (no-op)
      assert.strictEqual(archetypeA, archetypeB);
    });

    it("archetypeTraverseAdd creates multiple distinct archetypes", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);

      const root = world.archetypes.root;

      // Add different components from root
      const archetypeA = archetypeTraverseAdd(world, root, positionId);
      const archetypeB = archetypeTraverseAdd(world, root, velocityId);

      // Should create different archetypes
      assert.notStrictEqual(archetypeA, archetypeB);
      assert.deepStrictEqual(archetypeA.types, [positionId]);
      assert.deepStrictEqual(archetypeB.types, [velocityId]);
    });
  });

  describe("Archetype Traverse Remove", () => {
    it("archetypeTraverseRemove creates archetype on first traversal", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);

      const archetypeA = createAndRegisterArchetype(world, [positionId, velocityId], new Map());
      const archetypeB = archetypeTraverseRemove(world, archetypeA, velocityId);

      // Should create archetype with only position
      assert.deepStrictEqual(archetypeB.types, [positionId]);
    });

    it("archetypeTraverseRemove caches forward edge", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);

      const archetypeA = createAndRegisterArchetype(world, [positionId, velocityId], new Map());
      const archetypeB = archetypeTraverseRemove(world, archetypeA, velocityId);

      // Forward edge should be cached (A - velocity -> B)
      const cachedArchetype = archetypeA.edges.get(velocityId);
      assert.strictEqual(cachedArchetype, archetypeB);
    });

    it("archetypeTraverseRemove caches backward edge", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);

      const archetypeA = createAndRegisterArchetype(world, [positionId, velocityId], new Map());
      const archetypeB = archetypeTraverseRemove(world, archetypeA, velocityId);

      // Backward edge should be cached (B + velocity -> A)
      const cachedArchetype = archetypeB.edges.get(velocityId);
      assert.strictEqual(cachedArchetype, archetypeA);
    });

    it("archetypeTraverseRemove uses cached edge on second traversal", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);

      const archetypeA = createAndRegisterArchetype(world, [positionId, velocityId], new Map());

      // First traversal caches edge
      const archetypeB1 = archetypeTraverseRemove(world, archetypeA, velocityId);

      // Second traversal should use cached edge
      const archetypeB2 = archetypeTraverseRemove(world, archetypeA, velocityId);

      // Should return same archetype instance (O(1) lookup)
      assert.strictEqual(archetypeB1, archetypeB2);
    });

    it("archetypeTraverseRemove is idempotent (component not present)", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);

      const archetypeA = createAndRegisterArchetype(world, [positionId], new Map());

      // Removing component that doesn't exist
      const archetypeB = archetypeTraverseRemove(world, archetypeA, velocityId);

      // Should return same archetype (no-op)
      assert.strictEqual(archetypeA, archetypeB);
    });

    it("archetypeTraverseRemove creates root archetype when removing last component", () => {
      const world = createWorld();
      const positionId = createEntity(world);

      const archetypeA = createAndRegisterArchetype(world, [positionId], new Map());
      const archetypeB = archetypeTraverseRemove(world, archetypeA, positionId);

      // Should be root archetype
      assert.strictEqual(archetypeB, world.archetypes.root);
    });
  });

  describe("Bidirectional Edge Caching", () => {
    it("traverseAdd and traverseRemove create symmetric edges", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);

      const archetypeA = createAndRegisterArchetype(world, [positionId], new Map());

      // Add velocity (A -> B)
      const archetypeB = archetypeTraverseAdd(world, archetypeA, velocityId);

      // Remove velocity (B -> A)
      const archetypeC = archetypeTraverseRemove(world, archetypeB, velocityId);

      // Should return original archetype (symmetric)
      assert.strictEqual(archetypeA, archetypeC);
    });

    it("traverseRemove uses backward edge from traverseAdd", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);

      const archetypeA = createAndRegisterArchetype(world, [positionId], new Map());

      // Add velocity (caches backward edge on B)
      const archetypeB = archetypeTraverseAdd(world, archetypeA, velocityId);

      // Remove velocity should use backward edge cached during add
      const archetypeC = archetypeTraverseRemove(world, archetypeB, velocityId);

      // Should return original archetype (uses cached edge)
      assert.strictEqual(archetypeA, archetypeC);
    });

    it("multiple component additions create separate edges", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);
      const healthId = createEntity(world);

      const root = world.archetypes.root;
      // Root starts with 1 edge to NameRegistry archetype
      const initialEdges = root.edges.size;

      // Add different components
      const archetypeA = archetypeTraverseAdd(world, root, positionId);
      const archetypeB = archetypeTraverseAdd(world, root, velocityId);
      const archetypeC = archetypeTraverseAdd(world, root, healthId);

      // Root should have three additional forward edges cached
      assert.strictEqual(root.edges.size, initialEdges + 3);
      assert.strictEqual(root.edges.get(positionId), archetypeA);
      assert.strictEqual(root.edges.get(velocityId), archetypeB);
      assert.strictEqual(root.edges.get(healthId), archetypeC);
    });

    it("complex archetype graph maintains edge integrity", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);

      const root = world.archetypes.root;

      // Build graph: root -> [position] -> [position, velocity]
      const archetype1 = archetypeTraverseAdd(world, root, positionId);
      const archetype12 = archetypeTraverseAdd(world, archetype1, velocityId);

      // Build graph: root -> [velocity] -> [position, velocity]
      const archetype2 = archetypeTraverseAdd(world, root, velocityId);
      const archetype12_alt = archetypeTraverseAdd(world, archetype2, positionId);

      // Both paths should converge to same archetype
      assert.strictEqual(archetype12, archetype12_alt);

      // Edge integrity checks (direct references)
      assert.strictEqual(root.edges.get(positionId), archetype1);
      assert.strictEqual(root.edges.get(velocityId), archetype2);
      assert.strictEqual(archetype1.edges.get(velocityId), archetype12);
      assert.strictEqual(archetype2.edges.get(positionId), archetype12);

      // Backward edges (direct references)
      assert.strictEqual(archetype1.edges.get(positionId), root);
      assert.strictEqual(archetype2.edges.get(velocityId), root);
      assert.strictEqual(archetype12.edges.get(positionId), archetype2);
      assert.strictEqual(archetype12.edges.get(velocityId), archetype1);
    });

    it("reuses existing archetype from byId cache (cache-first optimization)", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);

      // Pre-register an archetype with Position+Velocity
      const preRegistered = createAndRegisterArchetype(world, [positionId, velocityId], new Map());
      const archetypeCount = world.archetypes.byId.size;

      // Traverse from a new archetype with Position, adding Velocity
      const archetypeA = createAndRegisterArchetype(world, [positionId], new Map());
      const result = archetypeTraverseAdd(world, archetypeA, velocityId);

      // Should return the pre-registered archetype (cache hit via byId)
      assert.strictEqual(result, preRegistered);

      // No new archetype should be created (only archetypeA was added)
      assert.strictEqual(world.archetypes.byId.size, archetypeCount + 1);
    });

    it("reuses existing archetype from byId cache on remove (cache-first optimization)", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const velocityId = createEntity(world);

      // Pre-register an archetype with Position only
      const preRegistered = createAndRegisterArchetype(world, [positionId], new Map());
      const archetypeCount = world.archetypes.byId.size;

      // Traverse from a new archetype with Position+Velocity, removing Velocity
      const archetypeAB = createAndRegisterArchetype(world, [positionId, velocityId], new Map());
      const result = archetypeTraverseRemove(world, archetypeAB, velocityId);

      // Should return the pre-registered archetype (cache hit via byId)
      assert.strictEqual(result, preRegistered);

      // No new archetype should be created (only archetypeAB was added)
      assert.strictEqual(world.archetypes.byId.size, archetypeCount + 1);
    });
  });

  // ============================================================================
  // Archetype Cleanup
  // ============================================================================

  describe("Archetype Cleanup", () => {
    it("populates component records when archetype is created", () => {
      const world = createWorld();
      const entityA = createEntity(world);
      const entityB = createEntity(world);

      const registry = world.entities;

      // Create archetype using entityA as component
      const archetype = createAndRegisterArchetype(world, [entityA], new Map());

      // Check that archetype reference is in entityA's records
      const metaA = registry.byId.get(entityA)!;
      assert.ok(metaA.records.includes(archetype));

      // entityB should have empty records (not used as component)
      const metaB = registry.byId.get(entityB)!;
      assert.strictEqual(metaB.records.length, 0);
    });

    it("destroys archetypes with dead component types", () => {
      const world = createWorld();
      const entityA = createEntity(world);

      // Create archetype using entityA as component
      const archetype = createAndRegisterArchetype(world, [entityA], new Map());
      const archetypeHash = archetype.hash;

      // Archetype should exist before destruction
      assert.ok(world.archetypes.byId.has(archetypeHash));

      // Destroy entityA (makes archetype invalid)
      destroyEntity(world, entityA);

      // Archetype should be destroyed (contains dead component type)
      assert.strictEqual(world.archetypes.byId.get(archetypeHash), undefined);
    });

    it("cleans up component records during archetype destruction", () => {
      const world = createWorld();
      const entityA = createEntity(world);
      const entityB = createEntity(world);

      const registry = world.entities;

      // Create archetype with both entities as components
      const archetype = createAndRegisterArchetype(world, [entityA, entityB], new Map());

      // Both should have records pointing to archetype
      const metaA = registry.byId.get(entityA)!;
      const metaB = registry.byId.get(entityB)!;
      assert.ok(metaA.records.includes(archetype));
      assert.ok(metaB.records.includes(archetype));

      // Destroy entityA (triggers archetype destruction)
      destroyEntity(world, entityA);

      // Archetype destroyed, so entityB's records should be cleaned up
      const metaBAfter = registry.byId.get(entityB)!;
      assert.strictEqual(metaBAfter.records.includes(archetype), false);
    });

    it("cleans up bidirectional edges during archetype destruction", () => {
      const world = createWorld();
      const entityA = createEntity(world);
      const entityB = createEntity(world);

      // Create archetype with both entities as components
      const archetypeAB = createAndRegisterArchetype(world, [entityA, entityB], new Map());

      // Create another archetype with just entityA
      const archetypeA = createAndRegisterArchetype(world, [entityA], new Map());

      // Destroy entityA (triggers archetype destruction for both archetypes)
      destroyEntity(world, entityA);

      // Both archetypes should be destroyed (contain dead component type)
      assert.strictEqual(world.archetypes.byId.get(archetypeA.hash), undefined);
      assert.strictEqual(world.archetypes.byId.get(archetypeAB.hash), undefined);

      // Verify that edges were cleaned up (surviving archetypes have fewer edges)
      // This is an indirect check - we can't inspect destroyed archetypes
      // But we can verify that root archetype's edges were cleaned up
      const rootArchetype = world.archetypes.root;
      assert.strictEqual(rootArchetype.edges.has(entityA), false);
    });

    it("never destroys root archetype", () => {
      const world = createWorld();
      const rootArchetype = world.archetypes.root;

      // Create and destroy multiple entities
      const e1 = createEntity(world);
      const e2 = createEntity(world);
      const e3 = createEntity(world);

      destroyEntity(world, e1);
      destroyEntity(world, e2);
      destroyEntity(world, e3);

      // Root archetype should still exist (even though empty)
      assert.ok(world.archetypes.byId.has(rootArchetype.hash));
      assert.strictEqual(world.archetypes.root, rootArchetype);
    });

    it("destroyArchetype does not destroy root archetype", () => {
      const world = createWorld();
      const root = world.archetypes.root;

      destroyArchetype(world, root);

      // Root should still exist
      assert.strictEqual(world.archetypes.byId.has(root.hash), true);
    });

    it("preserves empty archetype with valid component types", () => {
      const world = createWorld();
      const entityA = createEntity(world);
      createEntity(world); // entityB

      // Create archetype with entityA as component
      const archetype = createAndRegisterArchetype(world, [entityA], new Map());

      // Move entityB (at root[1]) into archetype
      transferEntityToArchetypeByRow(world.archetypes.root, 1, archetype);

      // Verify entityB is in archetype
      assert.strictEqual(archetype.entities.length, 1);

      // Move entityB back to root (making archetype empty but with valid component type)
      transferEntityToArchetypeByRow(archetype, 0, world.archetypes.root);

      // Archetype should be empty now
      assert.strictEqual(archetype.entities.length, 0);

      // entityA is still alive, so archetype should remain (valid component type)
      assert.strictEqual(isEntityAlive(world, entityA), true);
      assert.ok(world.archetypes.byId.has(archetype.hash));

      // Now destroy entityA (makes archetype invalid)
      destroyEntity(world, entityA);

      // Archetype should be destroyed (dead component type, even though it was empty)
      assert.strictEqual(world.archetypes.byId.get(archetype.hash), undefined);
    });
  });

  // ============================================================================
  // Data Access
  // ============================================================================

  describe("Data Access", () => {
    it("returns entities in archetype", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const archetype = createArchetype([positionId], new Map());

      // Create entities and move them to archetype
      const e1 = createEntity(world);
      const e2 = createEntity(world);
      const e3 = createEntity(world);

      // Root now has: [positionId, e1, e2, e3]
      // Transfer e1, e2, e3 (indices 1, 2, 3) in reverse order to preserve creation order after swap-and-pop
      transferEntityToArchetypeByRow(world.archetypes.root, 3, archetype); // e3
      transferEntityToArchetypeByRow(world.archetypes.root, 2, archetype); // e2
      transferEntityToArchetypeByRow(world.archetypes.root, 1, archetype); // e1

      // Direct property access
      assert.strictEqual(archetype.entities.length, 3);
      assert.deepStrictEqual(archetype.entities, [e3, e2, e1]);
    });

    it("returns empty array for empty archetype", () => {
      const world = createWorld();
      const positionId = createEntity(world);
      const archetype = createArchetype([positionId], new Map());

      // Direct property access
      assert.deepStrictEqual(archetype.entities, []);
    });
  });

  // ============================================================================
  // Schema Storage
  // ============================================================================

  describe("Schema Storage", () => {
    it("stores schemas in Archetype.schemas map", () => {
      const world = createWorld();
      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 10.0, y: 20.0 });

      const meta = world.entities.byId.get(entity)!;
      const archetype = meta.archetype;

      // Schema should be cached in archetype
      const schema = archetype.schemas.get(Position);
      assert.ok(schema);
      assert.ok(schema.x);
      assert.ok(schema.y);
    });

    it("allocates columns based on schemas", () => {
      const world = createWorld();
      const Health = defineComponent("Health", {
        current: Type.i32(),
        max: Type.i32(),
      });

      const entity = createEntity(world);
      addComponent(world, entity, Health, { current: 80, max: 100 });

      const meta = world.entities.byId.get(entity)!;
      const archetype = meta.archetype;

      // Columns should exist for each field
      const fieldColumns = archetype.columns.get(Health);
      assert.ok(fieldColumns);
      assert.ok(fieldColumns.current);
      assert.ok(fieldColumns.max);
    });

    it("handles multiple components with different schemas", () => {
      const world = createWorld();
      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });
      const Velocity = defineComponent("Velocity", { x: Type.f32(), y: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 0.0, y: 0.0 });
      addComponent(world, entity, Velocity, { x: 1.0, y: 1.0 });

      const meta = world.entities.byId.get(entity)!;
      const archetype = meta.archetype;

      // Both schemas should be stored
      assert.ok(archetype.schemas.get(Position));
      assert.ok(archetype.schemas.get(Velocity));

      // Columns should exist for both components
      assert.ok(archetype.columns.get(Position));
      assert.ok(archetype.columns.get(Velocity));
    });

    it("stores empty schema for tags", () => {
      const world = createWorld();
      const tagId = createEntity(world);

      const archetype = createArchetype([tagId], new Map());

      // Tag has no schema entry
      assert.strictEqual(archetype.schemas.get(tagId), undefined);

      // Tag has no columns
      assert.strictEqual(archetype.columns.get(tagId), undefined);
    });
  });

  // ============================================================================
  // Schema Reuse
  // ============================================================================

  describe("Schema Reuse", () => {
    it("reuses archetype with same component set", () => {
      const world = createWorld();
      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });

      const e1 = createEntity(world);
      addComponent(world, e1, Position, { x: 10.0, y: 20.0 });

      const e2 = createEntity(world);
      addComponent(world, e2, Position, { x: 30.0, y: 40.0 });

      const meta1 = world.entities.byId.get(e1)!;
      const meta2 = world.entities.byId.get(e2)!;

      // Both entities should share same archetype
      assert.strictEqual(meta1.archetype, meta2.archetype);
    });

    it("preserves schemas during archetype transitions", () => {
      const world = createWorld();
      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });
      const Velocity = defineComponent("Velocity", { x: Type.f32(), y: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 0.0, y: 0.0 });

      // Get archetype with Position
      const meta1 = world.entities.byId.get(entity)!;
      const archetype1 = meta1.archetype;
      assert.ok(archetype1.schemas.get(Position));

      // Add Velocity (transitions to new archetype)
      addComponent(world, entity, Velocity, { x: 1.0, y: 1.0 });

      const meta2 = world.entities.byId.get(entity)!;
      const archetype2 = meta2.archetype;

      // New archetype should have both schemas
      assert.ok(archetype2.schemas.get(Position));
      assert.ok(archetype2.schemas.get(Velocity));
    });

    it("removes schema when component removed", () => {
      const world = createWorld();
      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });
      const Velocity = defineComponent("Velocity", { x: Type.f32(), y: Type.f32() });

      const entity = createEntity(world);
      addComponent(world, entity, Position, { x: 0.0, y: 0.0 });
      addComponent(world, entity, Velocity, { x: 1.0, y: 1.0 });

      // Archetype has both schemas
      const meta1 = world.entities.byId.get(entity)!;
      assert.ok(meta1.archetype.schemas.get(Position));
      assert.ok(meta1.archetype.schemas.get(Velocity));

      // Remove Position
      removeComponent(world, entity, Position);

      const meta2 = world.entities.byId.get(entity)!;

      // New archetype should only have Velocity schema
      assert.strictEqual(meta2.archetype.schemas.get(Position), undefined);
      assert.ok(meta2.archetype.schemas.get(Velocity));
    });

    it("preserves schema across multiple transitions", () => {
      const world = createWorld();
      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });
      const Velocity = defineComponent("Velocity", { x: Type.f32(), y: Type.f32() });
      const Health = defineComponent("Health", { current: Type.i32(), max: Type.i32() });

      const entity = createEntity(world);

      // Add Position
      addComponent(world, entity, Position, { x: 0.0, y: 0.0 });

      // Add Velocity (transition 1)
      addComponent(world, entity, Velocity, { x: 1.0, y: 1.0 });

      // Add Health (transition 2)
      addComponent(world, entity, Health, { current: 100, max: 100 });

      const meta = world.entities.byId.get(entity)!;
      const archetype = meta.archetype;

      // All schemas should be present
      assert.ok(archetype.schemas.get(Position));
      assert.ok(archetype.schemas.get(Velocity));
      assert.ok(archetype.schemas.get(Health));
    });
  });

  // ============================================================================
  // Entity Record Management
  // ============================================================================

  describe("Entity Record Management", () => {
    it("tracks archetypes in all component type records when created", () => {
      const world = createWorld();
      const typeA = createEntity(world);
      const typeB = createEntity(world);
      const typeC = createEntity(world);

      // Create archetype with all three types
      const archetype = createAndRegisterArchetype(world, [typeA, typeB, typeC], new Map());

      // Each type entity should have the archetype in its records
      const metaA = world.entities.byId.get(typeA)!;
      const metaB = world.entities.byId.get(typeB)!;
      const metaC = world.entities.byId.get(typeC)!;

      assert.ok(metaA.records.includes(archetype), "typeA should track archetype");
      assert.ok(metaB.records.includes(archetype), "typeB should track archetype");
      assert.ok(metaC.records.includes(archetype), "typeC should track archetype");
    });

    it("removes archetypes from all component type records when destroyed", () => {
      const world = createWorld();
      const typeA = createEntity(world);
      const typeB = createEntity(world);

      // Create archetype with both types
      const archetype = createAndRegisterArchetype(world, [typeA, typeB], new Map());

      // Verify records exist
      const metaA = world.entities.byId.get(typeA)!;
      const metaB = world.entities.byId.get(typeB)!;
      assert.ok(metaA.records.includes(archetype));
      assert.ok(metaB.records.includes(archetype));

      // Destroy typeA, which cascades to destroy the archetype
      destroyEntity(world, typeA);

      // typeB should no longer reference the destroyed archetype
      const metaBAfter = world.entities.byId.get(typeB)!;
      assert.strictEqual(
        metaBAfter.records.includes(archetype),
        false,
        "typeB records should be cleaned up after archetype destruction"
      );
    });

    it("tracks multiple archetypes sharing the same component type", () => {
      const world = createWorld();
      const sharedType = createEntity(world);
      const uniqueType1 = createEntity(world);
      const uniqueType2 = createEntity(world);

      // Create two archetypes that both include sharedType
      const archetype1 = createAndRegisterArchetype(world, [sharedType, uniqueType1], new Map());
      const archetype2 = createAndRegisterArchetype(world, [sharedType, uniqueType2], new Map());

      // sharedType should track both archetypes
      const sharedMeta = world.entities.byId.get(sharedType)!;
      assert.ok(sharedMeta.records.includes(archetype1));
      assert.ok(sharedMeta.records.includes(archetype2));
      assert.strictEqual(sharedMeta.records.length, 2);

      // Destroy uniqueType1 - only archetype1 should be removed from sharedType's records
      destroyEntity(world, uniqueType1);

      assert.strictEqual(sharedMeta.records.includes(archetype1), false, "archetype1 should be removed");
      assert.ok(sharedMeta.records.includes(archetype2), "archetype2 should remain");
      assert.strictEqual(sharedMeta.records.length, 1);
    });

    it("maintains accurate records through archetype graph construction", () => {
      const world = createWorld();
      const typeA = createEntity(world);
      const typeB = createEntity(world);
      const typeC = createEntity(world);

      // Build archetype graph incrementally
      const archetypeA = createAndRegisterArchetype(world, [typeA], new Map());
      const archetypeAB = createAndRegisterArchetype(world, [typeA, typeB], new Map());
      const archetypeABC = createAndRegisterArchetype(world, [typeA, typeB, typeC], new Map());

      // typeA should be in all three archetypes
      const metaA = world.entities.byId.get(typeA)!;
      assert.strictEqual(metaA.records.length, 3);
      assert.ok(metaA.records.includes(archetypeA));
      assert.ok(metaA.records.includes(archetypeAB));
      assert.ok(metaA.records.includes(archetypeABC));

      // typeB should be in two archetypes
      const metaB = world.entities.byId.get(typeB)!;
      assert.strictEqual(metaB.records.length, 2);
      assert.ok(metaB.records.includes(archetypeAB));
      assert.ok(metaB.records.includes(archetypeABC));

      // typeC should be in one archetype
      const metaC = world.entities.byId.get(typeC)!;
      assert.strictEqual(metaC.records.length, 1);
      assert.ok(metaC.records.includes(archetypeABC));
    });

    it("handles cascading archetype destruction correctly", () => {
      const world = createWorld();
      const typeA = createEntity(world);
      const typeB = createEntity(world);
      const typeC = createEntity(world);

      // Create multiple archetypes sharing typeA
      const archAB = createAndRegisterArchetype(world, [typeA, typeB], new Map());
      const archAC = createAndRegisterArchetype(world, [typeA, typeC], new Map());
      const archABC = createAndRegisterArchetype(world, [typeA, typeB, typeC], new Map());

      // All archetypes should be tracked
      const metaA = world.entities.byId.get(typeA)!;
      assert.strictEqual(metaA.records.length, 3);

      // Destroy typeA - all archetypes containing it should be destroyed
      destroyEntity(world, typeA);

      // All archetypes should be gone from registry
      assert.strictEqual(world.archetypes.byId.has(archAB.hash), false);
      assert.strictEqual(world.archetypes.byId.has(archAC.hash), false);
      assert.strictEqual(world.archetypes.byId.has(archABC.hash), false);

      // typeB and typeC records should be empty (their archetypes were destroyed)
      const metaB = world.entities.byId.get(typeB)!;
      const metaC = world.entities.byId.get(typeC)!;
      assert.strictEqual(metaB.records.length, 0);
      assert.strictEqual(metaC.records.length, 0);
    });

    it("preserves records for surviving archetypes during partial destruction", () => {
      const world = createWorld();
      const typeA = createEntity(world);
      const typeB = createEntity(world);
      const typeC = createEntity(world);

      // Create archetypes with different type combinations
      const archA = createAndRegisterArchetype(world, [typeA], new Map());
      const archAB = createAndRegisterArchetype(world, [typeA, typeB], new Map());
      const archBC = createAndRegisterArchetype(world, [typeB, typeC], new Map());

      // typeB is in archAB and archBC
      const metaB = world.entities.byId.get(typeB)!;
      assert.strictEqual(metaB.records.length, 2);

      // Destroy typeA - should only destroy archA and archAB
      destroyEntity(world, typeA);

      // archA and archAB should be destroyed
      assert.strictEqual(world.archetypes.byId.has(archA.hash), false);
      assert.strictEqual(world.archetypes.byId.has(archAB.hash), false);

      // archBC should survive since it doesn't contain typeA
      assert.ok(world.archetypes.byId.has(archBC.hash));

      // typeB should still track archBC
      assert.strictEqual(metaB.records.length, 1);
      assert.ok(metaB.records.includes(archBC));

      // typeC should still track archBC
      const metaC = world.entities.byId.get(typeC)!;
      assert.strictEqual(metaC.records.length, 1);
      assert.ok(metaC.records.includes(archBC));
    });
  });
});
