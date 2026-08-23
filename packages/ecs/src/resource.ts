import {
  addComponent,
  getComponentValue,
  getComponentVectorValue,
  getComponentVectorView,
  hasComponent,
  removeComponent,
  setComponentValue,
  setComponentVectorValue,
} from "./component.js";
import type { Component, EntityId, EntityWith } from "./encoding.js";
import type {
  InferSchema,
  InferSchemaRecord,
  ScalarFields,
  SchemaRecord,
  TypedArrayInstance,
  VectorFields,
} from "./schema.js";
import type { World } from "./world.js";

// ============================================================================
// Resource Operations
// ============================================================================

/**
 * Adds a world-level singleton resource with initial field values.
 *
 * Idempotent: adding a resource that already exists does nothing, and the
 * existing values are not overwritten. Read fields back with
 * {@link getResourceValue}.
 *
 * Acts as an assertion: after the call the component is narrowed, making the
 * typed accessors like {@link getResourceValue} return non-optional values.
 *
 * @example
 * ```typescript
 * const Time = defineComponent("Time", { schema: { delta: Type.f32() } });
 * addResource(world, Time, { delta: 0.016 });
 * ```
 */
export function addResource<S extends SchemaRecord, N extends string>(
  world: World,
  component: Component<S, N>,
  data: InferSchemaRecord<S>
): asserts component is Component<S, N> & EntityWith<Component<S, N>> {
  addComponent(world, component, [component, data]);
}

/**
 * Removes a resource from the world.
 *
 * Idempotent: removing a resource that is not present does nothing. Removal is
 * observable through `removed()` events.
 *
 * @example
 * ```typescript
 * removeResource(world, Time);
 * ```
 */
export function removeResource(world: World, component: EntityId): void {
  removeComponent(world, component, component);
}

/**
 * Checks whether a resource exists in the world.
 *
 * Acts as a type guard: a true result narrows the component, making the typed
 * accessors like {@link getResourceValue} return non-optional values.
 *
 * @example
 * ```typescript
 * if (hasResource(world, Time)) {
 *   const dt = getResourceValue(world, Time, "delta"); // number, not number | undefined
 * }
 * ```
 */
export function hasResource<S extends SchemaRecord, N extends string>(
  world: World,
  component: Component<S, N>
): component is Component<S, N> & EntityWith<Component<S, N>>;

export function hasResource(world: World, component: EntityId): boolean;

export function hasResource(world: World, component: EntityId): boolean {
  return hasComponent(world, component, component);
}

/**
 * Gets a scalar field value from a resource.
 *
 * Returns undefined when the resource is absent; narrow with
 * {@link hasResource} first for a non-optional type. Vector fields use
 * {@link getResourceVectorValue}.
 *
 * @example
 * ```typescript
 * const dt = getResourceValue(world, Time, "delta");
 * ```
 */
export function getResourceValue<S extends SchemaRecord, N extends string, K extends ScalarFields<S>>(
  world: World,
  component: Component<S, N> & EntityWith<Component<S, N>>,
  key: K
): InferSchema<S[K]>;

export function getResourceValue<S extends SchemaRecord, K extends ScalarFields<S>>(
  world: World,
  component: Component<S>,
  key: K
): InferSchema<S[K]> | undefined;

export function getResourceValue<S extends SchemaRecord, K extends ScalarFields<S>>(
  world: World,
  component: Component<S>,
  key: K
): InferSchema<S[K]> | undefined {
  return getComponentValue(world, component, component, key);
}

/**
 * Sets a scalar field value on a resource.
 *
 * No-op when the resource is absent. Marks the resource changed for
 * `changed()` query filters.
 *
 * @example
 * ```typescript
 * setResourceValue(world, Time, "delta", 0.033);
 * ```
 */
export function setResourceValue<S extends SchemaRecord, K extends ScalarFields<S>>(
  world: World,
  component: Component<S>,
  key: K,
  value: InferSchema<S[K]>
): void {
  setComponentValue(world, component, component, key, value);
}

// ============================================================================
// Vector Resource Operations
// ============================================================================

/**
 * Gets a vector field value from a resource as a tuple copy.
 *
 * Mutating the returned array does not affect stored data; use
 * {@link getResourceVectorView} for zero-copy access. Returns undefined when
 * the resource is absent; narrow with `hasResource` first for a non-optional
 * type.
 *
 * @example
 * ```typescript
 * const Gravity = defineComponent("Gravity", { schema: { value: Type.f32(3) } });
 * addResource(world, Gravity, { value: [0, -9.81, 0] });
 * const g = getResourceVectorValue(world, Gravity, "value"); // [number, number, number]
 * ```
 */
export function getResourceVectorValue<S extends SchemaRecord, N extends string, K extends VectorFields<S>>(
  world: World,
  component: Component<S, N> & EntityWith<Component<S, N>>,
  key: K
): InferSchema<S[K]>;

export function getResourceVectorValue<S extends SchemaRecord, K extends VectorFields<S>>(
  world: World,
  component: Component<S>,
  key: K
): InferSchema<S[K]> | undefined;

export function getResourceVectorValue<S extends SchemaRecord, K extends VectorFields<S>>(
  world: World,
  component: Component<S>,
  key: K
): InferSchema<S[K]> | undefined {
  return getComponentVectorValue(world, component, component, key);
}

/**
 * Sets a vector field value on a resource from a tuple.
 *
 * No-op when the resource is absent. Marks the resource changed for
 * `changed()` query filters.
 *
 * @example
 * ```typescript
 * setResourceVectorValue(world, Gravity, "value", [0, -20, 0]);
 * ```
 */
export function setResourceVectorValue<S extends SchemaRecord, N extends string, K extends VectorFields<S>>(
  world: World,
  component: Component<S, N> & EntityWith<Component<S, N>>,
  key: K,
  value: InferSchema<S[K]>
): void;

export function setResourceVectorValue<S extends SchemaRecord, K extends VectorFields<S>>(
  world: World,
  component: Component<S>,
  key: K,
  value: InferSchema<S[K]>
): void;

export function setResourceVectorValue<S extends SchemaRecord, K extends VectorFields<S>>(
  world: World,
  component: Component<S>,
  key: K,
  value: InferSchema<S[K]>
): void {
  setComponentVectorValue(world, component, component, key, value);
}

/**
 * Gets a zero-copy typed array view into a vector field on a resource.
 *
 * Mutations through the view write directly to stored data, bypassing change
 * detection -- call `markComponentChanged(world, component, component)` after
 * writing. Any structural change to the resource's storage invalidates the
 * view. Returns undefined when the resource is absent; narrow with
 * {@link hasResource} first for a non-optional type.
 *
 * @example
 * ```typescript
 * const Gravity = defineComponent("Gravity", { schema: { value: Type.f32(3) } });
 * const view = getResourceVectorView(world, Gravity, "value"); // Float32Array
 * view[1] = -20; // direct mutation, no copy
 * ```
 */
export function getResourceVectorView<S extends SchemaRecord, N extends string, K extends VectorFields<S>>(
  world: World,
  component: Component<S, N> & EntityWith<Component<S, N>>,
  key: K
): TypedArrayInstance;

export function getResourceVectorView<S extends SchemaRecord, K extends VectorFields<S>>(
  world: World,
  component: Component<S>,
  key: K
): TypedArrayInstance | undefined;

export function getResourceVectorView<S extends SchemaRecord, K extends VectorFields<S>>(
  world: World,
  component: Component<S>,
  key: K
): TypedArrayInstance | undefined {
  return getComponentVectorView(world, component, component, key);
}
