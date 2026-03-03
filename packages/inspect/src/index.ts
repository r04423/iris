import type { World } from "iris-ecs";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { attachBridge } from "./bridge.js";
import { DevToolsRoot } from "./components/devtools-root.js";
import { injectStyles } from "./lib/inject-styles.js";
import { createDevToolsStore, type DevToolsStore } from "./store.js";
import styles from "./styles.css?inline";

// ============================================================================
// Public Types
// ============================================================================

/**
 * Handle returned by {@link attachDevTools}.
 */
export type DevToolsHandle = {
  /** Unmount UI, detach observers, and remove injected DOM/CSS. */
  destroy: () => void;
  /** Zustand store exposed for testing and programmatic access. */
  store: DevToolsStore;
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Attaches a DevTools panel to the page for inspecting ECS world state.
 *
 * Creates a floating panel (bottom-right) that shows a searchable entity list
 * with live updates via ECS observer callbacks. The panel starts collapsed as
 * a small pill showing the entity count.
 *
 * Renders inside a Shadow DOM to isolate styles from the host application.
 * All dependencies (React, CSS, UI components) are bundled -- the consumer
 * only needs iris-ecs in their project.
 *
 * @param world - The ECS world instance to inspect
 * @returns A handle with `destroy()` to remove the DevTools and `store` for programmatic access
 *
 * @example
 * ```ts
 * import { createWorld } from "iris-ecs";
 * import { attachDevTools } from "iris-inspect";
 *
 * const world = createWorld();
 * const devtools = attachDevTools(world);
 *
 * // Later, to remove:
 * devtools.destroy();
 * ```
 */
export function attachDevTools(world: World): DevToolsHandle {
  const store = createDevToolsStore();
  const detachBridge = attachBridge(world, store);

  // Host element sits in the document; shadow root isolates styles
  const host = document.createElement("div");
  host.id = "iris-devtools-host";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const removeStyles = injectStyles(shadow, styles);

  // React render target inside the shadow root
  const mountPoint = document.createElement("div");
  shadow.appendChild(mountPoint);

  const root = createRoot(mountPoint);
  root.render(createElement(DevToolsRoot, { store }));

  return {
    destroy() {
      root.unmount();
      host.remove();
      detachBridge();
      removeStyles();
    },
    store,
  };
}
