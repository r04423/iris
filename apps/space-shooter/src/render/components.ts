import { defineComponent, Type } from "iris-ecs";
import type { GameRenderer } from "./renderer.js";

export const RendererResource = defineComponent("RendererResource", {
  instance: Type.ref<GameRenderer>(),
});
