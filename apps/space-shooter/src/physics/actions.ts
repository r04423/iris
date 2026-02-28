import type { EntityWith } from "iris-ecs";
import { defineActions, getComponentValue, setComponentValue, type World } from "iris-ecs";
import { Movement } from "../shared/components.js";

export const physicsActions = defineActions((world: World) => ({
  applyForce(entity: EntityWith<typeof Movement>, fx: number, fy: number): void {
    const currentFx = getComponentValue(world, entity, Movement, "fx");
    const currentFy = getComponentValue(world, entity, Movement, "fy");

    setComponentValue(world, entity, Movement, "fx", currentFx + fx);
    setComponentValue(world, entity, Movement, "fy", currentFy + fy);
  },
}));
