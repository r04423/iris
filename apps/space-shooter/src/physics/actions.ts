import type { EntityId } from "iris-ecs";
import { defineActions, getComponentValue, setComponentValue, type World } from "iris-ecs";
import { Movement } from "../shared/components.js";

export const physicsActions = defineActions((world: World) => ({
  applyForce(entity: EntityId, fx: number, fy: number): void {
    const currentFx = getComponentValue(world, entity, Movement, "fx") ?? 0;
    const currentFy = getComponentValue(world, entity, Movement, "fy") ?? 0;

    setComponentValue(world, entity, Movement, "fx", currentFx + fx);
    setComponentValue(world, entity, Movement, "fy", currentFy + fy);
  },
}));
