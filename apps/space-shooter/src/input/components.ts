import { defineComponent, Type } from "iris-ecs";

// Per-entity processed input (keyboard + mouse merged)
export const Input = defineComponent("Input", {
  schema: {
    thrust: Type.f32(),
    turn: Type.f32(),
    fire: Type.f32(),
  },
});

// Global input state resource -- holds JS references that can't be decomposed into scalars
export const InputState = defineComponent("InputState", {
  schema: {
    state: Type.ref<{ keys: Set<string>; mouseButton: boolean }>(),
  },
});
