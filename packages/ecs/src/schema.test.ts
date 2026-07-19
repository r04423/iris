import assert from "node:assert";
import { describe, it } from "node:test";
import { IrisInvalidArgument } from "./error.js";
import type { InferSchema, InferSchemaRecord, ScalarFields, Schema, VectorFields } from "./schema.js";
import { Type } from "./schema.js";

type Mode = 0 | 1;

declare enum StringState {
  Idle = "idle",
  Running = "running",
}

function acceptSchemaValue<T>(_schema: Schema<T>, _value: NoInfer<T>): void {}

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

  describe("Scalar Type Narrowing", () => {
    it("narrows scalars while keeping defaults and vectors broad", () => {
      acceptSchemaValue(Type.i8<Mode>(), 0);
      acceptSchemaValue(Type.i16<Mode>(), 0);
      acceptSchemaValue(Type.i32<Mode>(), 0);
      acceptSchemaValue(Type.u32<Mode>(), 0);
      acceptSchemaValue(Type.f32<Mode>(), 0);
      acceptSchemaValue(Type.f64<Mode>(), 0);
      acceptSchemaValue(Type.string<"idle" | "running">(), "idle");
      acceptSchemaValue(Type.string<StringState>(), "idle" as StringState.Idle);
      acceptSchemaValue(Type.bool<true>(), true);

      acceptSchemaValue(Type.u32(), 42);
      acceptSchemaValue(Type.string(), "anything");
      acceptSchemaValue(Type.bool(), false);
      acceptSchemaValue(Type.ref(), { anything: true });
      acceptSchemaValue(Type.f32(2), [42, 99]);

      // @ts-expect-error -- narrowed numeric schemas reject values outside their domain
      acceptSchemaValue(Type.u32<Mode>(), 2);
      // @ts-expect-error -- string enums require enum members rather than raw strings
      acceptSchemaValue(Type.string<StringState>(), "idle");
    });
  });

  describe("Reference Schema", () => {
    it("creates reference schema with generic kind", () => {
      const schema = Type.ref<{ x: number }>();

      assert.strictEqual(schema.kind, "generic");
      assert.strictEqual(schema.arrayConstructor, Array);
      assert.strictEqual(schema.typeName, "unknown");
    });

    it("infers reference field types as scalar fields", () => {
      const schema = {
        cache: Type.ref<Map<string, number>>(),
        position: Type.f32(2),
      };

      type Data = InferSchemaRecord<typeof schema>;

      const data: Data = {
        cache: new Map([["score", 1]]),
        position: [10, 20],
      };
      const cache: InferSchema<(typeof schema)["cache"]> = data.cache;
      const scalarField: ScalarFields<typeof schema> = "cache";
      const vectorField: VectorFields<typeof schema> = "position";

      // @ts-expect-error -- reference fields use scalar APIs, not vector APIs
      const invalidVectorField: VectorFields<typeof schema> = "cache";

      assert.strictEqual(cache.get("score"), 1);
      assert.strictEqual(scalarField, "cache");
      assert.strictEqual(vectorField, "position");
      assert.strictEqual(invalidVectorField, "cache");
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
      assert.throws(() => Type.f32(1), IrisInvalidArgument);
    });

    it("throws for stride greater than 16", () => {
      // @ts-expect-error -- testing runtime validation of invalid size
      assert.throws(() => Type.f32(17), IrisInvalidArgument);
    });
  });
});
