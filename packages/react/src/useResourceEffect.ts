import type { Component, SchemaRecord } from "iris-ecs";
import { useComponentEffect } from "./useComponentEffect.js";

// ============================================================================
// useResourceEffect
// ============================================================================

/**
 * Registers a side-effect callback that fires when a resource changes,
 * is added, or is removed.
 *
 * @param resource - The resource component to watch
 * @param callback - Called when the resource changes, is added, or is removed
 *
 * @example
 * ```tsx
 * import { useResourceEffect } from "iris-react";
 *
 * function ThemeEffect() {
 *   useResourceEffect(Theme, () => {
 *     document.body.dataset.theme = getCurrentTheme();
 *   });
 *   return null;
 * }
 * ```
 */
export function useResourceEffect<S extends SchemaRecord>(
  resource: Component<S>,
  // biome-ignore lint/suspicious/noConfusingVoidType: matches React's EffectCallback pattern
  callback: () => void | (() => void)
): void {
  useComponentEffect(resource, resource, callback);
}
