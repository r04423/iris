import {
  addComponent,
  getComponent,
  getComponentValue,
  getComponentView,
  hasComponent,
  markComponentChanged,
  removeComponent,
  setComponent,
  setComponentValue,
} from "./component.js";
import type { Component, EntityWith } from "./encoding.js";
import { IrisResourceNotFound } from "./error.js";
import type { InferSchema, InferSchemaRecord, SchemaRecord, TypedArrayInstance, VectorFields } from "./schema.js";
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
  addComponent(world, component, component, data);
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
export function removeResource(world: World, component: Component): void {
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
): component is Component<S, N> & EntityWith<Component<S, N>> {
  return hasComponent(world, component, component);
}

/**
 * Asserts that a resource is present in the world.
 *
 * @throws {IrisResourceNotFound} If the resource is absent
 *
 * @example
 * ```typescript
 * assertResource(world, Time);
 * const dt = getResourceValue(world, Time, "delta");
 * ```
 */
export function assertResource<S extends SchemaRecord, N extends string>(
  world: World,
  component: Component<S, N>
): asserts component is Component<S, N> & EntityWith<Component<S, N>> {
  if (!hasResource(world, component)) {
    throw new IrisResourceNotFound(component);
  }
}

/**
 * Gets a complete resource record snapshot.
 *
 * Returns undefined when the resource is absent; narrow with
 * {@link hasResource} first for a non-optional type. The record and its vector
 * fields are copies; reference fields retain their stored values.
 *
 * @example
 * ```typescript
 * const time = getResource(world, Time);
 * ```
 */
export function getResource<S extends SchemaRecord, N extends string>(
  world: World,
  component: Component<S, N> & EntityWith<Component<S, N>>
): InferSchemaRecord<S>;

export function getResource<S extends SchemaRecord>(
  world: World,
  component: Component<S>
): InferSchemaRecord<S> | undefined;

export function getResource<S extends SchemaRecord>(
  world: World,
  component: Component<S>
): InferSchemaRecord<S> | undefined {
  return getComponent(world, component, component);
}

/**
 * Replaces a complete resource record.
 *
 * No-op when the resource is absent. Marks the resource changed for
 * `changed()` query filters.
 *
 * @example
 * ```typescript
 * setResource(world, Time, { delta: 0.033 });
 * ```
 */
export function setResource<S extends SchemaRecord>(
  world: World,
  component: Component<S>,
  data: InferSchemaRecord<S>
): void {
  setComponent(world, component, component, data);
}

/**
 * Gets a field value from a resource.
 *
 * Scalar values are returned directly and vector fields as tuple copies.
 * Returns undefined when the resource is absent; narrow with
 * {@link hasResource} first for a non-optional type.
 *
 * @example
 * ```typescript
 * const dt = getResourceValue(world, Time, "delta");
 * ```
 */
export function getResourceValue<S extends SchemaRecord, N extends string, K extends keyof S>(
  world: World,
  component: Component<S, N> & EntityWith<Component<S, N>>,
  key: K
): InferSchema<S[K]>;

export function getResourceValue<S extends SchemaRecord, K extends keyof S>(
  world: World,
  component: Component<S>,
  key: K
): InferSchema<S[K]> | undefined;

export function getResourceValue<S extends SchemaRecord, K extends keyof S>(
  world: World,
  component: Component<S>,
  key: K
): InferSchema<S[K]> | undefined {
  return getComponentValue(world, component, component, key);
}

/**
 * Sets a field value on a resource.
 *
 * No-op when the resource is absent. Marks the resource changed for
 * `changed()` query filters.
 *
 * @example
 * ```typescript
 * setResourceValue(world, Time, "delta", 0.033);
 * ```
 */
export function setResourceValue<S extends SchemaRecord, K extends keyof S>(
  world: World,
  component: Component<S>,
  key: K,
  value: InferSchema<S[K]>
): void {
  setComponentValue(world, component, component, key, value);
}

// ============================================================================
// Resource Change Tracking
// ============================================================================

/**
 * Marks a resource as changed without writing a value.
 * No-op when the resource is absent.
 *
 * @example
 * ```typescript
 * const view = getResourceView(world, Gravity, "value");
 * view[1] = -20;
 * markResourceChanged(world, Gravity);
 * ```
 */
export function markResourceChanged(world: World, component: Component): void {
  markComponentChanged(world, component, component);
}

// ============================================================================
// Resource Views
// ============================================================================

/**
 * Gets a zero-copy typed array view into a vector field on a resource.
 *
 * Mutations through the view write directly to stored data, bypassing change
 * detection -- call {@link markResourceChanged} after writing. Any structural
 * change to the resource's storage invalidates the view. Returns undefined
 * when the resource is absent; narrow with {@link hasResource} first for a
 * non-optional type.
 *
 * @example
 * ```typescript
 * const Gravity = defineComponent("Gravity", { schema: { value: Type.f32(3) } });
 * const view = getResourceView(world, Gravity, "value"); // Float32Array
 * view[1] = -20; // direct mutation, no copy
 * ```
 */
export function getResourceView<S extends SchemaRecord, N extends string, K extends VectorFields<S>>(
  world: World,
  component: Component<S, N> & EntityWith<Component<S, N>>,
  key: K
): TypedArrayInstance;

export function getResourceView<S extends SchemaRecord, K extends VectorFields<S>>(
  world: World,
  component: Component<S>,
  key: K
): TypedArrayInstance | undefined;

export function getResourceView<S extends SchemaRecord, K extends VectorFields<S>>(
  world: World,
  component: Component<S>,
  key: K
): TypedArrayInstance | undefined {
  return getComponentView(world, component, component, key);
}
