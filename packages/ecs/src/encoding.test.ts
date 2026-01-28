import assert from "node:assert";
import { describe, it } from "node:test";
import {
  COMPONENT_TYPE,
  ENTITY_TYPE,
  encodeComponent,
  encodeEntity,
  encodePair,
  encodeRelation,
  encodeTag,
  extractId,
  extractMeta,
  extractPairRelationId,
  extractPairTargetId,
  extractPairTargetType,
  extractType,
  ID_MASK_8,
  ID_MASK_20,
  isPair,
  RELATIONSHIP_TYPE,
  TAG_TYPE,
} from "./encoding.js";

describe("Encoding", () => {
  describe("Entity Encoding", () => {
    it("encodes entity with raw ID and generation", () => {
      const encoded = encodeEntity(42, 3);

      assert.strictEqual(extractType(encoded), 0x1);
      assert.strictEqual(extractId(encoded), 42);
      assert.strictEqual(extractMeta(encoded), 3);
    });

    it("supports generation wraparound at 256", () => {
      const encoded = encodeEntity(100, 255);
      assert.strictEqual(extractMeta(encoded), 255);

      // Generation should wrap (handled by caller using & 0xff)
      const wrapped = encodeEntity(100, 256 & 0xff);
      assert.strictEqual(extractMeta(wrapped), 0);
    });

    it("supports max entity ID", () => {
      const encoded = encodeEntity(ID_MASK_20, 0);
      assert.strictEqual(extractId(encoded), ID_MASK_20);
    });
  });

  describe("Component/Tag Encoding", () => {
    it("encodes component with raw ID and zero meta", () => {
      const encoded = encodeComponent(123);

      assert.strictEqual(extractType(encoded), COMPONENT_TYPE);
      assert.strictEqual(extractId(encoded), 123);
      assert.strictEqual(extractMeta(encoded), 0);
    });

    it("encodes tag with raw ID and zero meta", () => {
      const encoded = encodeTag(456);

      assert.strictEqual(extractType(encoded), TAG_TYPE);
      assert.strictEqual(extractId(encoded), 456);
      assert.strictEqual(extractMeta(encoded), 0);
    });
  });

  describe("Relationship Encoding", () => {
    it("encodes relationship with 8-bit raw ID", () => {
      const encoded = encodeRelation(50);

      assert.strictEqual(extractType(encoded), RELATIONSHIP_TYPE);
      assert.strictEqual(extractId(encoded), 50);
      assert.strictEqual(extractMeta(encoded), 0);
    });

    it("supports max relationship ID", () => {
      const encoded = encodeRelation(ID_MASK_8);
      assert.strictEqual(extractId(encoded), ID_MASK_8);
    });
  });

  describe("Type Extraction", () => {
    it("distinguishes between entity, component, tag, and relationship types", () => {
      const entity = encodeEntity(1, 0);
      const component = encodeComponent(1);
      const tag = encodeTag(1);
      const relationship = encodeRelation(1);

      assert.strictEqual(extractType(entity), 0x1);
      assert.strictEqual(extractType(component), COMPONENT_TYPE);
      assert.strictEqual(extractType(tag), TAG_TYPE);
      assert.strictEqual(extractType(relationship), RELATIONSHIP_TYPE);
    });
  });

  describe("Pair Encoding", () => {
    it("encodes pair with relation and entity target", () => {
      const relation = encodeRelation(5);
      const target = encodeEntity(100, 0);
      const pair = encodePair(relation, target);

      assert.strictEqual(isPair(pair), true);
      assert.strictEqual(extractPairRelationId(pair), 5);
      assert.strictEqual(extractPairTargetId(pair), 100);
      assert.strictEqual(extractPairTargetType(pair), ENTITY_TYPE);
    });

    it("encodes pair with relation and tag target", () => {
      const relation = encodeRelation(10);
      const target = encodeTag(200);
      const pair = encodePair(relation, target);

      assert.strictEqual(isPair(pair), true);
      assert.strictEqual(extractPairRelationId(pair), 10);
      assert.strictEqual(extractPairTargetId(pair), 200);
      assert.strictEqual(extractPairTargetType(pair), TAG_TYPE);
    });

    it("encodes pair with relation and component target", () => {
      const relation = encodeRelation(15);
      const target = encodeComponent(300);
      const pair = encodePair(relation, target);

      assert.strictEqual(isPair(pair), true);
      assert.strictEqual(extractPairRelationId(pair), 15);
      assert.strictEqual(extractPairTargetId(pair), 300);
      assert.strictEqual(extractPairTargetType(pair), COMPONENT_TYPE);
    });

    it("encodes pair with relation and relation target", () => {
      const relation = encodeRelation(20);
      const target = encodeRelation(25);
      const pair = encodePair(relation, target);

      assert.strictEqual(isPair(pair), true);
      assert.strictEqual(extractPairRelationId(pair), 20);
      assert.strictEqual(extractPairTargetId(pair), 25);
      assert.strictEqual(extractPairTargetType(pair), RELATIONSHIP_TYPE);
    });

    it("supports max relation ID", () => {
      const relation = encodeRelation(ID_MASK_8);
      const target = encodeEntity(1, 0);
      const pair = encodePair(relation, target);

      assert.strictEqual(extractPairRelationId(pair), ID_MASK_8);
    });

    it("supports max target ID", () => {
      const relation = encodeRelation(1);
      const target = encodeEntity(ID_MASK_20, 0);
      const pair = encodePair(relation, target);

      assert.strictEqual(extractPairTargetId(pair), ID_MASK_20);
    });

    it("creates unique pairs for different relation-target combinations", () => {
      const relation = encodeRelation(1);
      const target1 = encodeEntity(10, 0);
      const target2 = encodeEntity(20, 0);

      const pair1 = encodePair(relation, target1);
      const pair2 = encodePair(relation, target2);

      assert.notStrictEqual(pair1, pair2);
    });
  });

  describe("Pair Detection", () => {
    it("returns false for all non-pair types", () => {
      assert.strictEqual(isPair(encodeEntity(1, 0)), false);
      assert.strictEqual(isPair(encodeComponent(1)), false);
      assert.strictEqual(isPair(encodeTag(1)), false);
      assert.strictEqual(isPair(encodeRelation(1)), false);
    });

    it("returns true for encoded pairs", () => {
      const relation = encodeRelation(1);
      const target = encodeEntity(1, 0);
      const pair = encodePair(relation, target);

      assert.strictEqual(isPair(pair), true);
    });
  });
});
