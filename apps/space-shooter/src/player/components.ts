import { defineComponent, defineTag, Type } from "iris-ecs";

export const IsPlayer = defineTag("IsPlayer");

export const PlayerConfig = defineComponent("PlayerConfig", {
  radius: Type.f32(),
  pushStrength: Type.f32(),
});
