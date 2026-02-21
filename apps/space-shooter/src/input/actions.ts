import { defineActions, type EntityId, getComponentValue, setComponentValue, type World } from "iris-ecs";
import { Input } from "./components.js";

export const inputActions = defineActions((world: World) => ({
  getInputThrust(entity: EntityId): number {
    return getComponentValue(world, entity, Input, "thrust") ?? 0;
  },

  getInputTurn(entity: EntityId): number {
    return getComponentValue(world, entity, Input, "turn") ?? 0;
  },

  getInputFire(entity: EntityId): number {
    return getComponentValue(world, entity, Input, "fire") ?? 0;
  },

  setInput(entity: EntityId, thrust: number, turn: number, fire: number): void {
    setComponentValue(world, entity, Input, "thrust", thrust);
    setComponentValue(world, entity, Input, "turn", turn);
    setComponentValue(world, entity, Input, "fire", fire);
  },
}));
