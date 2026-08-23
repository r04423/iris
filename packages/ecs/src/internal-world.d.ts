import type { WorldInternals } from "./world.js";

/** Adds the state fields used by the ECS implementation. */
declare module "./world.js" {
  interface World extends WorldInternals {}
}
