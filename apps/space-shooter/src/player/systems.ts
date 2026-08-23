import { addResource, defineSystem } from "iris-ecs";
import { playerActions } from "./actions.js";
import { PlayerConfig } from "./components.js";

export const initPlayer = defineSystem("initPlayer", (world) => {
  const { spawnPlayer } = playerActions(world);

  spawnPlayer(0, 0);
  addResource(world, PlayerConfig, { radius: 14, pushStrength: 0.5 });
});
