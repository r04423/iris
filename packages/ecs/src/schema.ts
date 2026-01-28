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
  kind: "typed" | "primitive" | "generic";
  arrayConstructor: TypedArrayConstructor | ArrayConstructor;
  typeName: string;
  __type?: T;
};

// ============================================================================
// Schema Factories
// ============================================================================

/**
 * Schema factory namespace for defining component storage types.
 *
 * Provides constructors for typed arrays (i8, f32, etc.), primitives (bool, string),
 * and generic objects. Use these to define component schemas.
 *
 * @example
 * ```typescript
 * const Position = { x: Type.f32(), y: Type.f32() };
 * const Health = { hp: Type.i32() };
 * const Name = { value: Type.string() };
 * ```
 */
export const Type = {
  /**
   * 8-bit signed integer schema (Int8Array).
   *
   * @returns Schema for Int8Array storage
   */
  i8: (): Schema<number> => ({
    kind: "typed",
    arrayConstructor: Int8Array,
    typeName: "number",
  }),

  /**
   * 16-bit signed integer schema (Int16Array).
   *
   * @returns Schema for Int16Array storage
   */
  i16: (): Schema<number> => ({
    kind: "typed",
    arrayConstructor: Int16Array,
    typeName: "number",
  }),

  /**
   * 32-bit signed integer schema (Int32Array).
   *
   * @returns Schema for Int32Array storage
   */
  i32: (): Schema<number> => ({
    kind: "typed",
    arrayConstructor: Int32Array,
    typeName: "number",
  }),

  /**
   * 32-bit unsigned integer schema (Uint32Array).
   *
   * @returns Schema for Uint32Array storage
   */
  u32: (): Schema<number> => ({
    kind: "typed",
    arrayConstructor: Uint32Array,
    typeName: "number",
  }),

  /**
   * 32-bit floating point schema (Float32Array).
   *
   * @returns Schema for Float32Array storage
   */
  f32: (): Schema<number> => ({
    kind: "typed",
    arrayConstructor: Float32Array,
    typeName: "number",
  }),

  /**
   * 64-bit floating point schema (Float64Array).
   *
   * @returns Schema for Float64Array storage
   */
  f64: (): Schema<number> => ({
    kind: "typed",
    arrayConstructor: Float64Array,
    typeName: "number",
  }),

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
