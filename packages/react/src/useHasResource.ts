import type { Component } from "iris-ecs";
import { useHasComponent } from "./useHasComponent.js";

// ============================================================================
// useHasResource
// ============================================================================

/**
 * Returns whether a resource exists, updating reactively when it is added
 * or removed.
 *
 * @param resource - The resource component to check
 * @returns `true` if the resource exists, `false` otherwise
 *
 * @example
 * ```tsx
 * import { useHasResource } from "iris-react";
 *
 * function TimeDisplay() {
 *   const hasTime = useHasResource(Time);
 *   return hasTime ? <span>Running</span> : null;
 * }
 * ```
 */
export function useHasResource(resource: Component): boolean {
  return useHasComponent(resource, resource);
}
