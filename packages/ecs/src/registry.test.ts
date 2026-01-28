import assert from "node:assert";
import { describe, it } from "node:test";
import {
  COMPONENT_TYPE,
  extractId,
  extractMeta,
  extractType,
  ID_MASK_8,
  ID_MASK_20,
  RELATIONSHIP_TYPE,
  TAG_TYPE,
} from "./encoding.js";
import { COMPONENT_REGISTRY, defineComponent, defineRelation, defineTag, Wildcard } from "./registry.js";
import { Type } from "./schema.js";

describe("Registry", () => {
  // ============================================================================
  // Tag Definition
  // ============================================================================

  describe("Tag Definition", () => {
    it("allocates sequential tag IDs", () => {
      const startId = COMPONENT_REGISTRY.nextTagId;

      const Tag1 = defineTag("Tag1");
      const Tag2 = defineTag("Tag2");

      assert.strictEqual(extractId(Tag1), startId);
      assert.strictEqual(extractId(Tag2), startId + 1);
    });

    it("stores metadata in global registry", () => {
      const Player = defineTag("Player");

      const meta = COMPONENT_REGISTRY.byId.get(Player);
      assert.ok(meta);
      assert.strictEqual(meta.name, "Player");
      assert.strictEqual(meta.schema, undefined);
    });

    it("encodes tags with TAG_TYPE", () => {
      const Enemy = defineTag("Enemy");

      assert.strictEqual(extractType(Enemy), TAG_TYPE);
      assert.strictEqual(extractMeta(Enemy), 0);
    });

    it("enforces tag ID limit", () => {
      const originalNextId = COMPONENT_REGISTRY.nextTagId;

      // Set to limit
      COMPONENT_REGISTRY.nextTagId = ID_MASK_20 + 1;

      assert.throws(() => {
        defineTag("OverLimit");
      }, RangeError);

      // Restore
      COMPONENT_REGISTRY.nextTagId = originalNextId;
    });
  });

  // ============================================================================
  // Data Component Definition
  // ============================================================================

  describe("Data Component Definition", () => {
    it("allocates sequential component IDs", () => {
      const startId = COMPONENT_REGISTRY.nextComponentId;

      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });
      const Velocity = defineComponent("Velocity", { x: Type.f32(), y: Type.f32() });

      assert.strictEqual(extractId(Position), startId);
      assert.strictEqual(extractId(Velocity), startId + 1);
    });

    it("stores metadata with schema in global registry", () => {
      const Health = defineComponent("Health", {
        current: Type.i32(),
        max: Type.i32(),
      });

      const meta = COMPONENT_REGISTRY.byId.get(Health);

      assert.ok(meta);
      assert.strictEqual(meta.name, "Health");
      assert.ok(meta.schema);
      assert.ok(meta.schema.current);
      assert.ok(meta.schema.max);
    });

    it("encodes components with COMPONENT_TYPE", () => {
      const Transform = defineComponent("Transform", {
        x: Type.f32(),
        y: Type.f32(),
        rotation: Type.f32(),
      });

      assert.strictEqual(extractType(Transform), COMPONENT_TYPE);
      assert.strictEqual(extractMeta(Transform), 0);
    });

    it("enforces component ID limit", () => {
      const originalNextId = COMPONENT_REGISTRY.nextComponentId;

      // Set to limit
      COMPONENT_REGISTRY.nextComponentId = ID_MASK_20 + 1;

      assert.throws(() => {
        defineComponent("OverLimit", { value: Type.i32() });
      }, RangeError);

      // Restore
      COMPONENT_REGISTRY.nextComponentId = originalNextId;
    });
  });

  // ============================================================================
  // Relation Definition
  // ============================================================================

  describe("Relation Definition", () => {
    it("allocates sequential relation IDs", () => {
      const startId = COMPONENT_REGISTRY.nextRelationId;

      const ChildOf = defineRelation("ChildOf");
      const Follows = defineRelation("Follows");

      assert.strictEqual(extractId(ChildOf), startId);
      assert.strictEqual(extractId(Follows), startId + 1);
    });

    it("stores metadata without schema for tag relations", () => {
      const ChildOf = defineRelation("ChildOf");

      const meta = COMPONENT_REGISTRY.byId.get(ChildOf);
      assert.ok(meta);
      assert.strictEqual(meta.name, "ChildOf");
      assert.strictEqual(meta.schema, undefined);
    });

    it("stores metadata with schema for data relations", () => {
      const Amount = defineRelation("Amount", { schema: { value: Type.f32() } });

      const meta = COMPONENT_REGISTRY.byId.get(Amount);
      assert.ok(meta);
      assert.strictEqual(meta.name, "Amount");
      assert.ok(meta.schema);
      assert.ok(meta.schema.value);
    });

    it("encodes relations with RELATIONSHIP_TYPE", () => {
      const Contains = defineRelation("Contains");

      assert.strictEqual(extractType(Contains), RELATIONSHIP_TYPE);
      assert.strictEqual(extractMeta(Contains), 0);
    });

    it("enforces relation ID limit (256)", () => {
      const originalNextId = COMPONENT_REGISTRY.nextRelationId;

      // Set to limit
      COMPONENT_REGISTRY.nextRelationId = ID_MASK_8 + 1;

      assert.throws(() => {
        defineRelation("OverLimit");
      }, RangeError);

      // Restore
      COMPONENT_REGISTRY.nextRelationId = originalNextId;
    });

    it("defines relations with complex schemas", () => {
      const Ownership = defineRelation("Ownership", {
        schema: { since: Type.string(), shares: Type.f32() },
      });

      const meta = COMPONENT_REGISTRY.byId.get(Ownership);
      assert.ok(meta);
      assert.ok(meta.schema);
      assert.ok(meta.schema.since);
      assert.ok(meta.schema.shares);
    });
  });

  // ============================================================================
  // Wildcard Built-in Relation
  // ============================================================================

  describe("Wildcard Built-in Relation", () => {
    it("is defined as first relation (ID 0)", () => {
      // Wildcard is defined when registry.ts is imported, so it should be ID 0
      assert.strictEqual(extractType(Wildcard), RELATIONSHIP_TYPE);
    });

    it("has name 'Wildcard'", () => {
      const meta = COMPONENT_REGISTRY.byId.get(Wildcard);
      assert.ok(meta);
      assert.strictEqual(meta.name, "Wildcard");
    });

    it("has no schema", () => {
      const meta = COMPONENT_REGISTRY.byId.get(Wildcard);
      assert.ok(meta);
      assert.strictEqual(meta.schema, undefined);
    });

    it("is a valid relation type", () => {
      assert.strictEqual(extractType(Wildcard), RELATIONSHIP_TYPE);
    });
  });

  // ============================================================================
  // Registry Isolation
  // ============================================================================

  describe("Registry Isolation", () => {
    it("maintains separate counters for tags, components, and relations", () => {
      const tagStart = COMPONENT_REGISTRY.nextTagId;
      const componentStart = COMPONENT_REGISTRY.nextComponentId;
      const relationStart = COMPONENT_REGISTRY.nextRelationId;

      const Tag1 = defineTag("IsolationTag1");
      const Component1 = defineComponent("IsolationComponent1", { value: Type.i32() });
      const Relation1 = defineRelation("IsolationRelation1");

      // Each counter increments independently
      assert.strictEqual(extractId(Tag1), tagStart);
      assert.strictEqual(extractId(Component1), componentStart);
      assert.strictEqual(extractId(Relation1), relationStart);

      assert.strictEqual(COMPONENT_REGISTRY.nextTagId, tagStart + 1);
      assert.strictEqual(COMPONENT_REGISTRY.nextComponentId, componentStart + 1);
      assert.strictEqual(COMPONENT_REGISTRY.nextRelationId, relationStart + 1);
    });

    it("stores all types in same byId map", () => {
      const tag = defineTag("MapTestTag");
      const component = defineComponent("MapTestComponent", { value: Type.i32() });
      const relation = defineRelation("MapTestRelation");

      // All accessible from same map
      assert.ok(COMPONENT_REGISTRY.byId.has(tag));
      assert.ok(COMPONENT_REGISTRY.byId.has(component));
      assert.ok(COMPONENT_REGISTRY.byId.has(relation));
    });
  });
});
