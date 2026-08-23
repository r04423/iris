import {
  addComponent,
  createEntity,
  defineActions,
  destroyEntity,
  type Entity,
  type EntityId,
  type EntityWith,
  getComponentValue,
  hasComponent,
  pair,
  removeComponent,
  setComponentValue,
  type World,
} from "iris-ecs";
import type { IsPlayer } from "../player/components.js";
import { Transform } from "../shared/components.js";
import { FiredBy } from "../shared/relations.js";
import { between } from "../utils/between.js";
import { Bullet, IsBullet, IsShieldVisible, ShieldVisibility, ShootCooldown } from "./components.js";

export const combatActions = defineActions((world: World) => ({
  // ===========================================================================
  // Bullet lifecycle
  // ===========================================================================

  spawnBullet(x: number, y: number, dx: number, dy: number, firedBy?: Entity): Entity {
    const entity = createEntity(world);

    addComponent(world, entity, IsBullet);
    addComponent(world, entity, [Transform, { x, y, rotation: Math.atan2(dy, dx) }]);
    addComponent(world, entity, [
      Bullet,
      {
        speed: between(500, 540),
        dx,
        dy,
        lifetime: between(1.0, 1.4),
        timeAlive: 0,
      },
    ]);

    if (firedBy !== undefined) {
      addComponent(world, entity, pair(FiredBy, firedBy));
    }

    return entity;
  },

  despawnBullet(entity: EntityId): void {
    destroyEntity(world, entity);
  },

  getBulletDirection(entity: EntityWith<typeof Bullet>): [number, number] {
    const dx = getComponentValue(world, entity, Bullet, "dx");
    const dy = getComponentValue(world, entity, Bullet, "dy");

    return [dx, dy];
  },

  getBulletSpeed(entity: EntityWith<typeof Bullet>): number {
    return getComponentValue(world, entity, Bullet, "speed");
  },

  getBulletLifetime(entity: EntityWith<typeof Bullet>): [number, number] {
    const lifetime = getComponentValue(world, entity, Bullet, "lifetime");
    const timeAlive = getComponentValue(world, entity, Bullet, "timeAlive");

    return [lifetime, timeAlive];
  },

  setBulletTimeAlive(entity: EntityWith<typeof Bullet>, timeAlive: number): void {
    setComponentValue(world, entity, Bullet, "timeAlive", timeAlive);
  },

  // ===========================================================================
  // Shoot cooldown
  // ===========================================================================

  canShoot(entity: EntityWith<typeof ShootCooldown>): boolean {
    return getComponentValue(world, entity, ShootCooldown, "canShoot");
  },

  getShootCooldownState(entity: EntityWith<typeof ShootCooldown>): [number, number] {
    const cooldown = getComponentValue(world, entity, ShootCooldown, "cooldown");
    const timer = getComponentValue(world, entity, ShootCooldown, "timer");

    return [cooldown, timer];
  },

  setShootCooldownState(entity: EntityWith<typeof ShootCooldown>, canShoot: boolean, timer: number): void {
    setComponentValue(world, entity, ShootCooldown, "canShoot", canShoot);
    setComponentValue(world, entity, ShootCooldown, "timer", timer);
  },

  // ===========================================================================
  // Shield
  // ===========================================================================

  activateShield(entity: EntityWith<typeof IsPlayer>, duration: number): void {
    if (!hasComponent(world, entity, ShieldVisibility)) {
      addComponent(world, entity, [ShieldVisibility, { duration, current: 0 }]);
    } else {
      setComponentValue(world, entity, ShieldVisibility, "current", 0);
    }
  },

  deactivateShield(entity: EntityId): void {
    removeComponent(world, entity, ShieldVisibility);
    if (hasComponent(world, entity, IsShieldVisible)) {
      removeComponent(world, entity, IsShieldVisible);
    }
  },

  getShieldProgress(entity: EntityWith<typeof ShieldVisibility>): [number, number] {
    const duration = getComponentValue(world, entity, ShieldVisibility, "duration");
    const current = getComponentValue(world, entity, ShieldVisibility, "current");

    return [duration, current];
  },

  setShieldCurrent(entity: EntityWith<typeof ShieldVisibility>, current: number): void {
    setComponentValue(world, entity, ShieldVisibility, "current", current);
  },

  isShieldVisible(entity: EntityId): boolean {
    return hasComponent(world, entity, IsShieldVisible);
  },

  showShield(entity: EntityId): void {
    if (!hasComponent(world, entity, IsShieldVisible)) {
      addComponent(world, entity, IsShieldVisible);
    }
  },

  hideShield(entity: EntityId): void {
    if (hasComponent(world, entity, IsShieldVisible)) {
      removeComponent(world, entity, IsShieldVisible);
    }
  },
}));
