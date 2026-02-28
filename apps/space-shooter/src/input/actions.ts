import { defineActions, type EntityWith, getComponentValue, setComponentValue, type World } from "iris-ecs";
import { Input } from "./components.js";

export const inputActions = defineActions((world: World) => ({
  getInputThrust(entity: EntityWith<typeof Input>): number {
    return getComponentValue(world, entity, Input, "thrust");
  },

  getInputTurn(entity: EntityWith<typeof Input>): number {
    return getComponentValue(world, entity, Input, "turn");
  },

  getInputFire(entity: EntityWith<typeof Input>): number {
    return getComponentValue(world, entity, Input, "fire");
  },

  setInput(entity: EntityWith<typeof Input>, thrust: number, turn: number, fire: number): void {
    setComponentValue(world, entity, Input, "thrust", thrust);
    setComponentValue(world, entity, Input, "turn", turn);
    setComponentValue(world, entity, Input, "fire", fire);
  },
}));
