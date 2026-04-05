import { assert, InvalidArgument } from "./error.js";

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Typed array constructor type.
 *
 * Union of all typed array constructors that can be used for numeric storage.
 */
export type TypedArrayConstructor =
  | Int8ArrayConstructor
  | Int16ArrayConstructor
  | Int32ArrayConstructor
  | Uint32ArrayConstructor
  | Float32ArrayConstructor
  | Float64ArrayConstructor;

// ============================================================================
// Vector Tuple Types
// ============================================================================

/**
 * Maps a numeric size to a fixed-length tuple type.
 *
 * @internal
 */
type VectorTupleMap<T> = {
  2: [T, T];
  3: [T, T, T];
  4: [T, T, T, T];
  5: [T, T, T, T, T];
  6: [T, T, T, T, T, T];
  7: [T, T, T, T, T, T, T];
  8: [T, T, T, T, T, T, T, T];
  9: [T, T, T, T, T, T, T, T, T];
  10: [T, T, T, T, T, T, T, T, T, T];
  11: [T, T, T, T, T, T, T, T, T, T, T];
  12: [T, T, T, T, T, T, T, T, T, T, T, T];
  13: [T, T, T, T, T, T, T, T, T, T, T, T, T];
  14: [T, T, T, T, T, T, T, T, T, T, T, T, T, T];
  15: [T, T, T, T, T, T, T, T, T, T, T, T, T, T, T];
  16: [T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T];
};

/**
 * Valid vector sizes (2-16).
 *
 * @internal
 */
type VectorSize = keyof VectorTupleMap<unknown>;

/**
 * Fixed-length tuple type for vector schemas.
 *
 * Maps a base type and numeric size to a tuple: `VectorTuple<number, 3>` becomes `[number, number, number]`.
 */
export type VectorTuple<T, N extends VectorSize> = VectorTupleMap<T>[N];

// ============================================================================
// Schema Type
// ============================================================================

/**
 * Type descriptor for columnar storage.
 *
 * Describes how component data should be stored (typed arrays for numbers,
 * regular arrays for primitives/objects). Created via Type namespace factories.
 *
 * @template T - TypeScript type of stored values (inferred via phantom __type field)
 *
 * @example
 * ```typescript
 * const posX: Schema<number> = Type.f32();
 * const name: Schema<string> = Type.string();
 * ```
 */
export type Schema<T = unknown> = {
  kind: "typed" | "primitive" | "generic" | "vector";
  arrayConstructor: TypedArrayConstructor | ArrayConstructor;
  typeName: string;
  stride?: number;
  __type?: T;
};

// ============================================================================
// Schema Factories
// ============================================================================

/**
 * Overloaded numeric type factory.
 *
 * Returns a scalar `Schema<number>` when called without arguments, or a vector
 * `Schema<VectorTuple<number, N>>` when called with a size (2-16).
 *
 * @internal
 */
type NumericFactory = {
  (): Schema<number>;
  <N extends VectorSize>(size: N): Schema<VectorTuple<number, N>>;
};

/** @internal */
function numericFactory(ArrayCtor: TypedArrayConstructor): NumericFactory {
  return ((size?: number) => {
    if (size === undefined) {
      return { kind: "typed", arrayConstructor: ArrayCtor, typeName: "number" };
    }

    assert(size >= 2 && size <= 16, InvalidArgument, {
      expected: "vector size between 2 and 16",
      actual: String(size),
    });

    return { kind: "vector", arrayConstructor: ArrayCtor, typeName: "number", stride: size };
  }) as NumericFactory;
}

/**
 * Schema factory namespace for defining component storage types.
 *
 * Provides constructors for typed arrays (i8, f32, etc.), primitives (bool, string),
 * and generic objects. Numeric factories accept an optional size parameter for
 * interleaved vector storage.
 *
 * @example
 * ```typescript
 * const Position = { value: Type.f32(2) };      // vec2
 * const Color = { value: Type.u32(4) };          // vec4
 * const Health = { hp: Type.i32() };             // scalar
 * const Name = { value: Type.string() };
 * ```
 */
export const Type = {
  /** 8-bit signed integer schema (Int8Array). Accepts optional vector size (2-16). */
  i8: numericFactory(Int8Array),

  /** 16-bit signed integer schema (Int16Array). Accepts optional vector size (2-16). */
  i16: numericFactory(Int16Array),

  /** 32-bit signed integer schema (Int32Array). Accepts optional vector size (2-16). */
  i32: numericFactory(Int32Array),

  /** 32-bit unsigned integer schema (Uint32Array). Accepts optional vector size (2-16). */
  u32: numericFactory(Uint32Array),

  /** 32-bit floating point schema (Float32Array). Accepts optional vector size (2-16). */
  f32: numericFactory(Float32Array),

  /** 64-bit floating point schema (Float64Array). Accepts optional vector size (2-16). */
  f64: numericFactory(Float64Array),

  /**
   * Boolean schema (Array<boolean>).
   *
   * @returns Schema for Array<boolean> storage
   */
  bool: (): Schema<boolean> => ({
    kind: "primitive",
    arrayConstructor: Array,
    typeName: "boolean",
  }),

  /**
   * String schema (Array<string>).
   *
   * @returns Schema for Array<string> storage
   */
  string: (): Schema<string> => ({
    kind: "primitive",
    arrayConstructor: Array,
    typeName: "string",
  }),

  /**
   * Generic object schema (Array<T>).
   *
   * @template T - TypeScript type of objects stored
   * @returns Schema for Array<T> storage
   */
  object: <T>(): Schema<T> => ({
    kind: "generic",
    arrayConstructor: Array,
    typeName: "unknown",
  }),
};

// ============================================================================
// Type Inference
// ============================================================================

/**
 * Infer TypeScript type from a schema using the phantom __type field.
 *
 * @template S - Schema type to infer from
 */
export type InferSchema<S extends Schema> = S extends Schema<infer T> ? T : never;

/**
 * Union of all typed array instance types.
 */
export type TypedArrayInstance = InstanceType<TypedArrayConstructor>;

/**
 * Extracts field names from a schema record where the field is stored with stride 1
 * (scalars and object references -- anything that isn't an interleaved vector tuple).
 */
export type ScalarFields<S extends SchemaRecord> = {
  [K in keyof S]: InferSchema<S[K]> extends unknown[] ? never : K;
}[keyof S];

/**
 * Extracts field names from a schema record where the field is a vector type (tuple).
 */
export type VectorFields<S extends SchemaRecord> = {
  [K in keyof S]: InferSchema<S[K]> extends unknown[] ? K : never;
}[keyof S];

// ============================================================================
// Schema Record Types
// ============================================================================

/**
 * Schema record for component fields.
 *
 * Maps field names to their schema definitions.
 */
export type SchemaRecord = Record<string, Schema>;

/**
 * Infer TypeScript types from component schema record.
 *
 * Maps each schema field to its inferred type via phantom __type field.
 */
export type InferSchemaRecord<S extends SchemaRecord> = {
  [K in keyof S]: S[K] extends Schema<infer T> ? T : never;
};
