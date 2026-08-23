import {
  addComponent,
  collectEntities,
  createEntity,
  defineActions,
  type Entity,
  queryFirstEntity,
  setName,
  type World,
} from "iris-ecs";
import { ShootCooldown } from "../combat/components.js";
import { Input } from "../input/components.js";
import { Movement, Transform } from "../shared/components.js";
import { IsPlayer } from "./components.js";

export const playerActions = defineActions((world: World) => ({
  spawnPlayer(x = 0, y = 0): Entity {
    const entity = createEntity(world);

    setName(world, entity, "Player");
    addComponent(world, entity, IsPlayer);
    addComponent(world, entity, Transform, { x, y, rotation: 0 });
    addComponent(world, entity, Movement, {
      vx: 0,
      vy: 0,
      fx: 0,
      fy: 0,
      thrust: 300,
      maxSpeed: 200,
      damping: 0.98,
      rotationSpeed: 4.0,
    });
    addComponent(world, entity, Input, { thrust: 0, turn: 0, fire: 0 });
    addComponent(world, entity, ShootCooldown, { cooldown: 0.08, timer: 0, canShoot: true });

    return entity;
  },

  getPlayer() {
    return queryFirstEntity(world, [IsPlayer, Transform]);
  },

  getPlayerCount(): number {
    return collectEntities(world, [IsPlayer]).length;
  },
}));
