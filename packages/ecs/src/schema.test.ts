import assert from "node:assert";
import { describe, it } from "node:test";
import { InvalidArgument } from "./error.js";
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

  describe("Vector Schema", () => {
    it("creates vec2 f32 schema with stride 2", () => {
      const schema = Type.f32(2);
      assert.strictEqual(schema.kind, "vector");
      assert.strictEqual(schema.stride, 2);
      assert.strictEqual(schema.arrayConstructor, Float32Array);
      assert.strictEqual(schema.typeName, "number");
    });

    it("creates vec3 i32 schema with stride 3", () => {
      const schema = Type.i32(3);
      assert.strictEqual(schema.kind, "vector");
      assert.strictEqual(schema.stride, 3);
      assert.strictEqual(schema.arrayConstructor, Int32Array);
    });

    it("creates vec4 f64 schema with stride 4", () => {
      const schema = Type.f64(4);
      assert.strictEqual(schema.kind, "vector");
      assert.strictEqual(schema.stride, 4);
      assert.strictEqual(schema.arrayConstructor, Float64Array);
    });

    it("creates scalar schema when no size argument", () => {
      const schema = Type.f32();
      assert.strictEqual(schema.kind, "typed");
      assert.strictEqual(schema.stride, undefined);
    });

    it("supports all numeric type factories", () => {
      const schemas = [Type.i8(2), Type.i16(2), Type.i32(2), Type.u32(2), Type.f32(2), Type.f64(2)];
      for (const schema of schemas) {
        assert.strictEqual(schema.kind, "vector");
        assert.strictEqual(schema.stride, 2);
      }
    });

    it("supports max stride of 16", () => {
      const schema = Type.f32(16);
      assert.strictEqual(schema.kind, "vector");
      assert.strictEqual(schema.stride, 16);
    });

    it("throws for stride less than 2", () => {
      // @ts-expect-error -- testing runtime validation of invalid size
      assert.throws(() => Type.f32(1), InvalidArgument);
    });

    it("throws for stride greater than 16", () => {
      // @ts-expect-error -- testing runtime validation of invalid size
      assert.throws(() => Type.f32(17), InvalidArgument);
    });
  });
});
