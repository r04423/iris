import { defineComponent, Type } from "iris-ecs";

export const IsPlayer = defineComponent("IsPlayer");

export const PlayerConfig = defineComponent("PlayerConfig", {
  schema: {
    radius: Type.f32(),
    pushStrength: Type.f32(),
  },
});
