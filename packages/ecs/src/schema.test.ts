import assert from "node:assert";
import { describe, it } from "node:test";
import { Type } from "./schema.js";

describe("Schema", () => {
  describe("Typed Array Schemas", () => {
    it("creates correct schema for each typed array type", () => {
      const schemas = [
        { schema: Type.i8(), expected: Int8Array },
        { schema: Type.i16(), expected: Int16Array },
        { schema: Type.i32(), expected: Int32Array },
        { schema: Type.u32(), expected: Uint32Array },
        { schema: Type.f32(), expected: Float32Array },
        { schema: Type.f64(), expected: Float64Array },
      ];

      for (const { schema, expected } of schemas) {
        assert.strictEqual(schema.kind, "typed");
        assert.strictEqual(schema.arrayConstructor, expected);
        assert.strictEqual(schema.typeName, "number");
      }
    });

    it("returns new schema object on each call", () => {
      const schema1 = Type.f32();
      const schema2 = Type.f32();

      assert.notStrictEqual(schema1, schema2);
    });
  });

  describe("Primitive Schemas", () => {
    it("creates boolean schema with primitive kind", () => {
      const schema = Type.bool();

      assert.strictEqual(schema.kind, "primitive");
      assert.strictEqual(schema.arrayConstructor, Array);
      assert.strictEqual(schema.typeName, "boolean");
    });

    it("creates string schema with primitive kind", () => {
      const schema = Type.string();

      assert.strictEqual(schema.kind, "primitive");
      assert.strictEqual(schema.arrayConstructor, Array);
      assert.strictEqual(schema.typeName, "string");
    });
  });

  describe("Generic Object Schema", () => {
    it("creates object schema with generic kind", () => {
      const schema = Type.object<{ x: number }>();

      assert.strictEqual(schema.kind, "generic");
      assert.strictEqual(schema.arrayConstructor, Array);
      assert.strictEqual(schema.typeName, "unknown");
    });
  });
});
