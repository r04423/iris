import { IrisInvalidVectorSize } from "./error.js";

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Union of typed array constructors usable for numeric column storage.
 * @internal
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
 * Maps a vector size to its fixed-length tuple type.
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
 */
type VectorSize = keyof VectorTupleMap<unknown>;

/**
 * Fixed-length tuple type of a vector field: `VectorTuple<number, 3>` is
 * `[number, number, number]`.
 *
 * The value type produced by the sized {@link Type} factories like
 * `Type.f32(3)` and exchanged by the vector accessors.
 */
export type VectorTuple<T, N extends VectorSize> = VectorTupleMap<T>[N];

// ============================================================================
// Schema Type
// ============================================================================

/** Type-level brand for vector schemas; never exists at runtime. */
declare const VECTOR_SCHEMA_BRAND: unique symbol;

/**
 * Storage descriptor for a single component field.
 *
 * Created by the {@link Type} factories. The value type `T` is inferred
 * automatically, so explicit annotations are rarely needed.
 *
 * @example
 * ```typescript
 * const hp: Schema<number> = Type.i32();
 * const label: Schema<string> = Type.string();
 * ```
 */
export type Schema<T = unknown> = {
  kind: "typed" | "primitive" | "generic" | "vector";
  arrayConstructor: TypedArrayConstructor | ArrayConstructor;
  typeName: string;
  stride?: number;
  // Phantom field: carries T for inference at zero runtime cost, never assigned
  __type?: T;
};

/**
 * Schema for vector fields (e.g. `Type.f32(3)`). The phantom brand lets
 * `ScalarFields`/`VectorFields` discriminate vector schemas at the type level
 * without inspecting the inferred value type.
 *
 * @internal
 */
export type VectorSchema<T = unknown> = Schema<T> & {
  readonly [VECTOR_SCHEMA_BRAND]: true;
};

// ============================================================================
// Schema Factories
// ============================================================================

/**
 * Overloaded numeric factory: a scalar `Schema` with no argument, a vector
 * schema when given a size (2-16).
 */
type NumericFactory = {
  <T extends number = number>(): Schema<T>;
  <N extends VectorSize>(size: N): VectorSchema<VectorTuple<number, N>>;
};

/**
 * Builds the scalar/vector factory for one typed-array constructor, validating
 * vector sizes at definition time so invalid strides never reach storage.
 */
function numericFactory(ArrayCtor: TypedArrayConstructor): NumericFactory {
  return ((size?: number) => {
    if (size === undefined) {
      return { kind: "typed", arrayConstructor: ArrayCtor, typeName: "number" };
    }

    if (!(size >= 2 && size <= 16)) {
      throw new IrisInvalidVectorSize(size);
    }

    return { kind: "vector", arrayConstructor: ArrayCtor, typeName: "number", stride: size };
  }) as NumericFactory;
}

/**
 * Factory namespace for the field schemas passed to `defineComponent` and
 * `defineRelation`.
 *
 * Numeric factories take an optional size (2-16) to declare a fixed-length
 * vector field, read and written through the vector accessors like
 * `getComponentVectorValue`. Value types flow into the accessors
 * automatically -- no annotations needed.
 *
 * @example
 * ```typescript
 * const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });
 * const Velocity = defineComponent("Velocity", { value: Type.f32(2) }); // vec2
 * const Player = defineComponent("Player", {
 *   name: Type.string(),
 *   alive: Type.bool(),
 *   inventory: Type.ref<Map<string, number>>(),
 * });
 * ```
 */
export const Type = {
  /**
   * 8-bit signed integer schema (Int8Array). Pass a size for a vector field.
   *
   * @throws {IrisInvalidVectorSize} If the size is outside 2-16
   */
  i8: numericFactory(Int8Array),

  /**
   * 16-bit signed integer schema (Int16Array). Pass a size for a vector field.
   *
   * @throws {IrisInvalidVectorSize} If the size is outside 2-16
   */
  i16: numericFactory(Int16Array),

  /**
   * 32-bit signed integer schema (Int32Array). Pass a size for a vector field.
   *
   * @throws {IrisInvalidVectorSize} If the size is outside 2-16
   */
  i32: numericFactory(Int32Array),

  /**
   * 32-bit unsigned integer schema (Uint32Array). Pass a size for a vector field.
   *
   * @throws {IrisInvalidVectorSize} If the size is outside 2-16
   */
  u32: numericFactory(Uint32Array),

  /**
   * 32-bit floating point schema (Float32Array). Pass a size for a vector field.
   *
   * @throws {IrisInvalidVectorSize} If the size is outside 2-16
   */
  f32: numericFactory(Float32Array),

  /**
   * 64-bit floating point schema (Float64Array). Pass a size for a vector field.
   *
   * @throws {IrisInvalidVectorSize} If the size is outside 2-16
   */
  f64: numericFactory(Float64Array),

  /** Boolean field schema. */
  bool: <T extends boolean = boolean>(): Schema<T> => ({
    kind: "primitive",
    arrayConstructor: Array,
    typeName: "boolean",
  }),

  /** String field schema. Narrows to a literal union via `Type.string<"a" | "b">()`. */
  string: <T extends string = string>(): Schema<T> => ({
    kind: "primitive",
    arrayConstructor: Array,
    typeName: "string",
  }),

  /**
   * Reference field schema for arbitrary JavaScript values -- objects, arrays,
   * Maps, Sets, class instances. Pass the value type explicitly:
   * `Type.ref<Map<string, number>>()`.
   */
  ref: <T = unknown>(): Schema<T> & { kind: "generic"; arrayConstructor: ArrayConstructor } => ({
    kind: "generic",
    arrayConstructor: Array,
    typeName: "unknown",
  }),
};

// ============================================================================
// Type Inference
// ============================================================================

/**
 * Infers the value type carried by a schema: `InferSchema<Schema<number>>` is
 * `number`.
 *
 * The value type the field accessors like `getComponentValue` return and
 * accept.
 */
export type InferSchema<S extends Schema> = S extends Schema<infer T> ? T : never;

/**
 * Union of all typed array instances.
 *
 * The type of the zero-copy views returned by `getComponentVectorView` and
 * `getResourceVectorView`.
 */
export type TypedArrayInstance = InstanceType<TypedArrayConstructor>;

/**
 * Field names of a schema record holding a single value per entity -- numbers,
 * strings, booleans, references.
 *
 * The field-name constraint of the scalar accessors: `getComponentValue`,
 * `setComponentValue`, and their resource equivalents accept only these keys.
 */
export type ScalarFields<S extends SchemaRecord> = {
  [K in keyof S]: S[K] extends VectorSchema ? never : K;
}[keyof S];

/**
 * Field names of a schema record declared as fixed-length vectors.
 *
 * The field-name constraint of the vector accessors: `getComponentVectorValue`,
 * `setComponentVectorValue`, and the view getters accept only these keys.
 */
export type VectorFields<S extends SchemaRecord> = {
  [K in keyof S]: S[K] extends VectorSchema ? K : never;
}[keyof S];

// ============================================================================
// Schema Record Types
// ============================================================================

/**
 * Maps field names to their schemas -- the shape `defineComponent` and
 * `defineRelation` accept.
 */
export type SchemaRecord = Record<string, Schema>;

/**
 * Infers the plain-object value shape of a schema record: the initial data
 * accepted by `addComponent` and `addResource`.
 *
 * `{ x: Type.f32(), y: Type.f32() }` infers as `{ x: number; y: number }`.
 */
export type InferSchemaRecord<S extends SchemaRecord> = {
  [K in keyof S]: S[K] extends Schema<infer T> ? T : never;
};
