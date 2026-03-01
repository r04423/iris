import type { Entity, EntityWith, World } from "iris-ecs";
import {
  addResource,
  cacheQuery,
  defineSystem,
  emitEvent,
  getResourceValue,
  hasComponent,
  hasEvents,
  isEntityAlive,
  queryEntities,
  queryFirstEntity,
  readEvents,
} from "iris-ecs";
import { enemyActions } from "../enemy/actions.js";
import { EnemyConfig, IsEnemy } from "../enemy/components.js";
import { inputActions } from "../input/actions.js";
import { Input } from "../input/components.js";
import { physicsActions } from "../physics/actions.js";
import { ScratchEntities, SpatialHash } from "../physics/components.js";
import { IsPlayer, PlayerConfig } from "../player/components.js";
import { movementActions, transformActions } from "../shared/actions.js";
import { Movement, Time, Transform } from "../shared/components.js";
import { between } from "../utils/between.js";
import { combatActions } from "./actions.js";
import { Bullet, CombatConfig, IsBullet, ShieldVisibility, ShootCooldown } from "./components.js";
import { EnemyKilled, PlayerHit } from "./events.js";

// ============================================================================
// Startup
// ============================================================================

export function initCombat(world: World): void {
  addResource(world, CombatConfig, {
    shootCooldown: 0.08,
    bulletRadius: 4,
    bulletSpawnOffset: 15,
    bulletSpreadAngle: 0.08,
    shieldDuration: 1400,
    shieldBlinkFrequency: 250,
    shieldRadius: 28,
  });
}

// ============================================================================
// Update
// ============================================================================

export const handleShooting = defineSystem("handleShooting", (world) => {
  const playerQuery = cacheQuery(world, IsPlayer, Transform, ShootCooldown, Input);

  const { getPosition, getRotation } = transformActions(world);
  const { canShoot: canShootAction, getShootCooldownState, setShootCooldownState, spawnBullet } = combatActions(world);
  const { getInputFire } = inputActions(world);

  return () => {
    const delta = getResourceValue(world, Time, "delta") ?? 0;
    const bulletSpawnOffset = getResourceValue(world, CombatConfig, "bulletSpawnOffset") ?? 15;
    const bulletSpreadAngle = getResourceValue(world, CombatConfig, "bulletSpreadAngle") ?? 0.08;

    const player = queryFirstEntity(world, playerQuery);

    if (player === undefined) {
      return;
    }

    let shootReady = canShootAction(player);
    const [cooldown, cooldownTimer] = getShootCooldownState(player);
    let timer = cooldownTimer;

    if (!shootReady) {
      timer += delta;

      if (timer >= cooldown) {
        shootReady = true;
        timer = 0;
      }

      setShootCooldownState(player, shootReady, timer);
    }

    const fireInput = getInputFire(player);

    if (fireInput > 0 && shootReady) {
      const [x, y] = getPosition(player);
      const rotation = getRotation(player);

      const dirX = Math.sin(rotation);
      const dirY = Math.cos(rotation);

      // Rotate direction by random spread angle for bullet inaccuracy
      const spreadAngle = between(-bulletSpreadAngle, bulletSpreadAngle);
      const cos = Math.cos(spreadAngle);
      const sin = Math.sin(spreadAngle);
      const spreadDirX = dirX * cos - dirY * sin;
      const spreadDirY = dirX * sin + dirY * cos;

      const spawnX = x + dirX * bulletSpawnOffset;
      const spawnY = y + dirY * bulletSpawnOffset;

      spawnBullet(spawnX, spawnY, spreadDirX, spreadDirY, player as Entity);

      setShootCooldownState(player, false, 0);
    }
  };
});

export const updateBullets = defineSystem("updateBullets", (world) => {
  const bullets = cacheQuery(world, IsBullet, Bullet, Transform);

  const { getPosition, setPosition } = transformActions(world);
  const { getBulletSpeed, getBulletDirection, getBulletLifetime, setBulletTimeAlive, despawnBullet } =
    combatActions(world);

  return () => {
    const delta = getResourceValue(world, Time, "delta") ?? 0;

    queryEntities(world, bullets, (entity) => {
      const speed = getBulletSpeed(entity);
      const [dx, dy] = getBulletDirection(entity);
      const [lifetime, timeAlive] = getBulletLifetime(entity);

      const [x, y] = getPosition(entity);
      setPosition(entity, x + dx * speed * delta, y + dy * speed * delta);

      const newTimeAlive = timeAlive + delta;
      setBulletTimeAlive(entity, newTimeAlive);

      if (newTimeAlive >= lifetime) {
        despawnBullet(entity);
      }
    });
  };
});

// Broad phase via spatial hash, narrow phase via circle-circle distance check.
// Emits EnemyKilled event to decouple collision detection from visual effects.
export const updateBulletCollisions = defineSystem("updateBulletCollisions", (world) => {
  const bullets = cacheQuery(world, IsBullet, Bullet, Transform);

  const { getPosition } = transformActions(world);
  const { despawnBullet } = combatActions(world);
  const { despawnEnemy } = enemyActions(world);

  return () => {
    const map = getResourceValue(world, SpatialHash, "map")!;
    const nearby = getResourceValue(world, ScratchEntities, "entities")!;
    const bulletRadius = getResourceValue(world, CombatConfig, "bulletRadius") ?? 4;
    const enemyRadius = getResourceValue(world, EnemyConfig, "radius") ?? 8;
    const hitRadius = bulletRadius + enemyRadius;

    queryEntities(world, bullets, (bullet) => {
      const [bx, by] = getPosition(bullet);

      map.getNearbyEntities(bx, by, hitRadius, nearby);

      let hitEnemy: EntityWith<typeof Transform> | undefined;

      for (let i = 0; i < nearby.length; i++) {
        const entity = nearby[i]!;

        if (!isEntityAlive(world, entity)) {
          continue;
        }

        if (!hasComponent(world, entity, IsEnemy) || !hasComponent(world, entity, Transform)) {
          continue;
        }

        const [ex, ey] = getPosition(entity);

        const dx = ex - bx;
        const dy = ey - by;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < hitRadius) {
          hitEnemy = entity;
          break;
        }
      }

      if (hitEnemy !== undefined) {
        const [ex, ey] = getPosition(hitEnemy);

        emitEvent(world, EnemyKilled, { x: ex, y: ey });

        despawnEnemy(hitEnemy);
        despawnBullet(bullet);
      }
    });
  };
});

// Push enemies away from the player proportional to player speed.
// Emits PlayerHit to decouple collision physics from shield feedback.
export const pushEnemies = defineSystem("pushEnemies", (world) => {
  const players = cacheQuery(world, IsPlayer, Transform, Movement);

  const { applyForce } = physicsActions(world);
  const { getPosition } = transformActions(world);
  const { getVelocity } = movementActions(world);

  return () => {
    const map = getResourceValue(world, SpatialHash, "map")!;
    const nearby = getResourceValue(world, ScratchEntities, "entities")!;
    const playerRadius = getResourceValue(world, PlayerConfig, "radius") ?? 14;
    const enemyRadius = getResourceValue(world, EnemyConfig, "radius") ?? 8;
    const pushStrength = getResourceValue(world, PlayerConfig, "pushStrength") ?? 0.5;
    const collisionRadius = playerRadius + enemyRadius;

    queryEntities(world, players, (player) => {
      const [px, py] = getPosition(player);
      const [pvx, pvy] = getVelocity(player);
      const playerSpeed = Math.sqrt(pvx * pvx + pvy * pvy);

      map.getNearbyEntities(px, py, collisionRadius, nearby);

      let hasCollision = false;

      for (let i = 0; i < nearby.length; i++) {
        const entity = nearby[i]!;
        if (!isEntityAlive(world, entity)) {
          continue;
        }

        if (
          !hasComponent(world, entity, IsEnemy) ||
          !hasComponent(world, entity, Transform) ||
          !hasComponent(world, entity, Movement)
        ) {
          continue;
        }

        const [ex, ey] = getPosition(entity);

        const dx = ex - px;
        const dy = ey - py;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= collisionRadius && dist > 0) {
          hasCollision = true;

          const pushX = (dx / dist) * playerSpeed * pushStrength;
          const pushY = (dy / dist) * playerSpeed * pushStrength;
          applyForce(entity, pushX, pushY);
        }
      }

      if (hasCollision) {
        emitEvent(world, PlayerHit);
      }
    });
  };
});

export const handlePlayerHit = defineSystem("handlePlayerHit", (world) => {
  const playerQuery = cacheQuery(world, IsPlayer);

  const { activateShield } = combatActions(world);

  return () => {
    if (!hasEvents(world, PlayerHit)) {
      return;
    }

    readEvents(world, PlayerHit, () => {});

    const player = queryFirstEntity(world, playerQuery);
    if (player === undefined) {
      return;
    }

    const shieldDuration = getResourceValue(world, CombatConfig, "shieldDuration") ?? 1400;
    activateShield(player, shieldDuration);
  };
});

// Blinks the shield using a sine wave: visible when sin > 0, hidden otherwise.
// The frequency controls how fast the shield flickers during its duration.
export const tickShieldVisibility = defineSystem("tickShieldVisibility", (world) => {
  const shields = cacheQuery(world, ShieldVisibility);

  const { getShieldProgress, setShieldCurrent, deactivateShield, isShieldVisible, showShield, hideShield } =
    combatActions(world);

  return () => {
    const delta = getResourceValue(world, Time, "delta") ?? 0;
    const blinkFrequency = getResourceValue(world, CombatConfig, "shieldBlinkFrequency") ?? 250;

    queryEntities(world, shields, (entity) => {
      const [duration, prevCurrent] = getShieldProgress(entity);
      const current = prevCurrent + delta * 1000;
      setShieldCurrent(entity, current);

      if (current >= duration) {
        deactivateShield(entity);
      } else {
        const shouldBeVisible = Math.sin((current / blinkFrequency) * Math.PI * 2) > 0;

        if (shouldBeVisible && !isShieldVisible(entity)) {
          showShield(entity);
        } else if (!shouldBeVisible && isShieldVisible(entity)) {
          hideShield(entity);
        }
      }
    });
  };
});
