import { defineEvent, Type } from "iris-ecs";

export const KeyDown = defineEvent("KeyDown", { key: Type.string() });
export const KeyUp = defineEvent("KeyUp", { key: Type.string() });
export const MouseButtonDown = defineEvent("MouseButtonDown");
export const MouseButtonUp = defineEvent("MouseButtonUp");
