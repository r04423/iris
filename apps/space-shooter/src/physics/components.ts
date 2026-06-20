import type { EntityId } from "iris-ecs";
import { defineComponent, Type } from "iris-ecs";
import type { SpatialHashMap } from "../utils/spatial-hash.js";

export const SpatialHash = defineComponent("SpatialHash", {
  map: Type.ref<SpatialHashMap>(),
});

export const PhysicsConfig = defineComponent("PhysicsConfig", {
  forceDamping: Type.f32(),
  forceThreshold: Type.f32(),
});

// Shared scratch buffer for spatial hash queries. All systems that call
// getNearbyEntities run sequentially, so one buffer is safe to share.
export const ScratchEntities = defineComponent("ScratchEntities", {
  entities: Type.ref<EntityId[]>(),
});
