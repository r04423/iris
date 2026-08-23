import { addResource, defineSystem, getResourceValue, setResourceValue } from "iris-ecs";
import { Time } from "./components.js";

// ============================================================================
// Startup
// ============================================================================

export const initTime = defineSystem("initTime", (world) => {
  addResource(world, Time, { delta: 0, last: 0 });
});

// ============================================================================
// First
// ============================================================================

// Computes frame delta from wall-clock time. Skips the first frame to avoid
// a large initial delta from page load.
export const updateTime = defineSystem("updateTime", (world) => {
  const last = getResourceValue(world, Time, "last") ?? 0;
  const now = performance.now();

  if (last === 0) {
    setResourceValue(world, Time, "last", now);
    setResourceValue(world, Time, "delta", 0);

    return;
  }

  const delta = (now - last) / 1000;
  setResourceValue(world, Time, "delta", delta);
  setResourceValue(world, Time, "last", now);
});
