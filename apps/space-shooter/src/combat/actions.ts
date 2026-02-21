import {
  addComponent,
  createEntity,
  defineActions,
  destroyEntity,
  type Entity,
  type EntityId,
  getComponentValue,
  hasComponent,
  pair,
  removeComponent,
  setComponentValue,
  type World,
} from "iris-ecs";
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
    addComponent(world, entity, Transform, { x, y, rotation: Math.atan2(dy, dx) });
    addComponent(world, entity, Bullet, {
      speed: between(500, 540),
      dx,
      dy,
      lifetime: between(1.0, 1.4),
      timeAlive: 0,
    });

    if (firedBy !== undefined) {
      addComponent(world, entity, pair(FiredBy, firedBy));
    }

    return entity;
  },

  despawnBullet(entity: EntityId): void {
    destroyEntity(world, entity);
  },

  getBulletDirection(entity: EntityId): [number, number] {
    const dx = getComponentValue(world, entity, Bullet, "dx") ?? 0;
    const dy = getComponentValue(world, entity, Bullet, "dy") ?? 1;
    return [dx, dy];
  },

  getBulletSpeed(entity: EntityId): number {
    return getComponentValue(world, entity, Bullet, "speed") ?? 60;
  },

  getBulletLifetime(entity: EntityId): [number, number] {
    const lifetime = getComponentValue(world, entity, Bullet, "lifetime") ?? 2;
    const timeAlive = getComponentValue(world, entity, Bullet, "timeAlive") ?? 0;
    return [lifetime, timeAlive];
  },

  setBulletTimeAlive(entity: EntityId, timeAlive: number): void {
    setComponentValue(world, entity, Bullet, "timeAlive", timeAlive);
  },

  // ===========================================================================
  // Shoot cooldown
  // ===========================================================================

  canShoot(entity: EntityId): boolean {
    return getComponentValue(world, entity, ShootCooldown, "canShoot") ?? true;
  },

  getShootCooldownState(entity: EntityId): [number, number] {
    const cooldown = getComponentValue(world, entity, ShootCooldown, "cooldown") ?? 0.08;
    const timer = getComponentValue(world, entity, ShootCooldown, "timer") ?? 0;
    return [cooldown, timer];
  },

  setShootCooldownState(entity: EntityId, canShoot: boolean, timer: number): void {
    setComponentValue(world, entity, ShootCooldown, "canShoot", canShoot);
    setComponentValue(world, entity, ShootCooldown, "timer", timer);
  },

  // ===========================================================================
  // Shield
  // ===========================================================================

  activateShield(entity: EntityId, duration: number): void {
    if (!hasComponent(world, entity, ShieldVisibility)) {
      addComponent(world, entity, ShieldVisibility, { duration, current: 0 });
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

  getShieldProgress(entity: EntityId): [number, number] {
    const duration = getComponentValue(world, entity, ShieldVisibility, "duration") ?? 1400;
    const current = getComponentValue(world, entity, ShieldVisibility, "current") ?? 0;
    return [duration, current];
  },

  setShieldCurrent(entity: EntityId, current: number): void {
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
