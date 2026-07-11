import type { Component, InferSchema, ScalarFields, SchemaRecord } from "iris-ecs";
import { useComponentValue } from "./useComponentValue.js";

// ============================================================================
// useResourceValue
// ============================================================================

/**
 * Returns a single resource field value, updating reactively when the
 * resource changes.
 *
 * @param resource - The resource component to read from
 * @param fieldName - The schema field to return
 * @returns The field value, or `undefined` if the resource is absent
 *
 * @example
 * ```tsx
 * import { useResourceValue } from "iris-react";
 *
 * function TimeDisplay() {
 *   const elapsed = useResourceValue(Time, "elapsed");
 *   return <span>{elapsed ?? 0}</span>;
 * }
 * ```
 */
export function useResourceValue<S extends SchemaRecord, K extends ScalarFields<S>>(
  resource: Component<S>,
  fieldName: K
): InferSchema<S[K]> | undefined {
  return useComponentValue(resource, resource, fieldName);
}
