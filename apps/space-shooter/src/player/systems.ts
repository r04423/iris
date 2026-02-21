import type { World } from "iris-ecs";
import { addResource } from "iris-ecs";
import { playerActions } from "./actions.js";
import { PlayerConfig } from "./components.js";

export function initPlayer(world: World): void {
  const { spawnPlayer } = playerActions(world);

  spawnPlayer(0, 0);
  addResource(world, PlayerConfig, { radius: 14, pushStrength: 0.5 });
}
