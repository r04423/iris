import { addComponent, getComponentValue, hasComponent, removeComponent, setComponentValue } from "./component.js";
import type { Component, EntityId } from "./encoding.js";
import type { InferSchema, InferSchemaRecord, SchemaRecord } from "./schema.js";
import type { World } from "./world.js";

/**
 * Adds a global resource (singleton) to the world using the component-on-self pattern.
 *
 * Resources are stored by adding the component to itself as an entity. Idempotent if already present.
 *
 * @param world - World instance
 * @param component - Component definition to use as resource
 * @param data - Initial values for the resource
 * @returns void
 *
 * @example
 * ```typescript
 * const Time = defineComponent("Time", { delta: Type.f32() });
 * addResource(world, Time, { delta: 0.016 });
 * ```
 */
export function addResource<S extends SchemaRecord>(
  world: World,
  component: Component<S>,
  data: InferSchemaRecord<S>
): void {
  addComponent(world, component, component, data);
}

/**
 * Removes a global resource from the world.
 *
 * @param world - World instance
 * @param component - Component definition (acting as resource handle)
 * @returns void
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
 * Checks if a global resource exists in the world.
 *
 * @param world - World instance
 * @param component - Component definition (acting as resource handle)
 * @returns True if the resource exists, false otherwise
 *
 * @example
 * ```typescript
 * if (hasResource(world, Time)) {
 *   // Time resource is available
 * }
 * ```
 */
export function hasResource(world: World, component: EntityId): boolean {
  return hasComponent(world, component, component);
}

/**
 * Gets the value of a specific field on a global resource.
 *
 * @param world - World instance
 * @param component - Component definition
 * @param key - Field name to retrieve
 * @returns The field value, or undefined if the resource is not present
 *
 * @example
 * ```typescript
 * const dt = getResourceValue(world, Time, "delta");
 * ```
 */
export function getResourceValue<S extends SchemaRecord, K extends keyof S>(
  world: World,
  component: Component<S>,
  key: K
): InferSchema<S[K]> | undefined {
  return getComponentValue(world, component, component, key);
}

/**
 * Sets the value of a specific field on a global resource.
 *
 * @param world - World instance
 * @param component - Component definition
 * @param key - Field name to set
 * @param value - New value for the field
 * @returns void
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
