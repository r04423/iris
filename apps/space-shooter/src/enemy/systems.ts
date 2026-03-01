import type { Entity, World } from "iris-ecs";
import {
  addResource,
  cacheQuery,
  defineSystem,
  getRelationTargets,
  getResourceValue,
  hasComponent,
  isEntityAlive,
  queryEntities,
  readEvents,
  setResourceValue,
} from "iris-ecs";
import { EnemyKilled } from "../combat/events.js";
import { ScratchEntities, SpatialHash } from "../physics/components.js";
import { playerActions } from "../player/actions.js";
import { movementActions, transformActions } from "../shared/actions.js";
import { Movement, Time, Transform } from "../shared/components.js";
import { Targeting } from "../shared/relations.js";
import { between } from "../utils/between.js";
import { enemyActions } from "./actions.js";
import { AutoRotate, Avoidance, EnemyConfig, EnemySpawner, Explosion, IsEnemy, IsExplosion } from "./components.js";

// ============================================================================
// Startup
// ============================================================================

export function initEnemies(world: World): void {
  addResource(world, EnemySpawner, { interval: 0.8, accumulatedTime: 0, max: 40 });
  addResource(world, EnemyConfig, { radius: 8, spawnRadiusMin: 400, spawnRadiusMax: 600 });
}

// ============================================================================
// Update
// ============================================================================

// Accumulates delta time and spawns one enemy per interval. Random jitter
// prevents enemies from arriving in predictable waves.
export const spawnEnemies = defineSystem("spawnEnemies", (world) => {
  const { getEnemyCount, spawnEnemy } = enemyActions(world);
  const { getPlayer } = playerActions(world);
  const { getPosition } = transformActions(world);

  return () => {
    const delta = getResourceValue(world, Time, "delta") ?? 0;
    const interval = getResourceValue(world, EnemySpawner, "interval") ?? 1;
    const max = getResourceValue(world, EnemySpawner, "max") ?? 50;
    let accumulatedTime = getResourceValue(world, EnemySpawner, "accumulatedTime") ?? 0;
    const spawnRadiusMin = getResourceValue(world, EnemyConfig, "spawnRadiusMin") ?? 400;
    const spawnRadiusMax = getResourceValue(world, EnemyConfig, "spawnRadiusMax") ?? 600;

    if (getEnemyCount() >= max) {
      return;
    }

    const player = getPlayer();
    let playerX = 0;
    let playerY = 0;

    if (player !== undefined) {
      [playerX, playerY] = getPosition(player);
    }

    accumulatedTime += delta;

    if (accumulatedTime >= interval) {
      accumulatedTime -= interval;

      // Spawn at random angle on a ring around the player
      const angle = Math.random() * Math.PI * 2;
      const radius = between(spawnRadiusMin, spawnRadiusMax);
      const spawnX = playerX + Math.cos(angle) * radius;
      const spawnY = playerY + Math.sin(angle) * radius;

      spawnEnemy(spawnX, spawnY, player as Entity);

      accumulatedTime -= between(-0.15, 0.15);
    }

    setResourceValue(world, EnemySpawner, "accumulatedTime", accumulatedTime);
  };
});

// Simple steering: dampen current velocity then accelerate toward the target.
// The combination of damping + directional thrust produces smooth pursuit curves.
export const followPlayer = defineSystem("followPlayer", (world) => {
  const enemies = cacheQuery(world, IsEnemy, Transform, Movement);

  const { getPosition } = transformActions(world);
  const { getVelocity, setVelocity, getThrust, getDamping } = movementActions(world);

  return () => {
    queryEntities(world, enemies, (entity) => {
      const targets = getRelationTargets(world, entity, Targeting);
      const target = targets[0];
      if (target === undefined) {
        return;
      }
      if (!hasComponent(world, target, Transform)) {
        return;
      }

      const [x, y] = getPosition(entity);
      const [targetX, targetY] = getPosition(target);

      const thrust = getThrust(entity);
      const damping = getDamping(entity);
      let [vx, vy] = getVelocity(entity);

      vx *= damping;
      vy *= damping;

      const dx = targetX - x;
      const dy = targetY - y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 0) {
        vx += (dx / dist) * thrust;
        vy += (dy / dist) * thrust;
      }

      setVelocity(entity, vx, vy);
    });
  };
});

// Flocking separation: each entity steers away from the average position of
// its nearby neighbors. Prevents enemies from stacking on top of each other.
export const updateAvoidance = defineSystem("updateAvoidance", (world) => {
  const avoiders = cacheQuery(world, Avoidance, Transform, Movement);

  const { getPosition } = transformActions(world);
  const { getVelocity, setVelocity } = movementActions(world);
  const { getAvoidanceRange } = enemyActions(world);

  return () => {
    const map = getResourceValue(world, SpatialHash, "map")!;
    const nearby = getResourceValue(world, ScratchEntities, "entities")!;

    queryEntities(world, avoiders, (entity) => {
      const range = getAvoidanceRange(entity);
      const [x, y] = getPosition(entity);

      map.getNearbyEntities(x, y, range, nearby);

      let avoidX = 0;
      let avoidY = 0;
      let count = 0;

      for (let i = 0; i < nearby.length; i++) {
        const neighbor = nearby[i]!;
        if (neighbor === entity) {
          continue;
        }

        if (!isEntityAlive(world, neighbor)) {
          continue;
        }

        if (!hasComponent(world, neighbor, Avoidance) || !hasComponent(world, neighbor, Transform)) {
          continue;
        }

        const [nx, ny] = getPosition(neighbor);

        const dx = nx - x;
        const dy = ny - y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= range && dist > 0) {
          avoidX += dx;
          avoidY += dy;
          count++;
        }
      }

      if (count > 0) {
        // Negate to steer away, normalize, and scale
        avoidX = -avoidX / count;
        avoidY = -avoidY / count;

        const len = Math.sqrt(avoidX * avoidX + avoidY * avoidY);
        if (len > 0) {
          avoidX = (avoidX / len) * 2;
          avoidY = (avoidY / len) * 2;
        }

        const [vx, vy] = getVelocity(entity);
        setVelocity(entity, vx + avoidX, vy + avoidY);
      }
    });
  };
});

export const updateAutoRotate = defineSystem("updateAutoRotate", (world) => {
  const rotators = cacheQuery(world, Transform, AutoRotate);

  const { getRotation, setRotation } = transformActions(world);
  const { getAutoRotateSpeed } = enemyActions(world);

  return () => {
    const delta = getResourceValue(world, Time, "delta") ?? 0;

    queryEntities(world, rotators, (entity) => {
      const speed = getAutoRotateSpeed(entity);
      const rotation = getRotation(entity);

      setRotation(entity, rotation + delta * speed);
    });
  };
});

export const handleEnemyKilled = defineSystem("handleEnemyKilled", (world) => {
  const { spawnExplosion } = enemyActions(world);

  return () => {
    readEvents(world, EnemyKilled, (data) => {
      spawnExplosion(data.x, data.y);
    });
  };
});

export const tickExplosion = defineSystem("tickExplosion", (world) => {
  const explosions = cacheQuery(world, IsExplosion, Explosion);

  const { getExplosionProgress, setExplosionCurrent, despawnExplosion } = enemyActions(world);

  return () => {
    const delta = getResourceValue(world, Time, "delta") ?? 0;

    queryEntities(world, explosions, (entity) => {
      const [duration, prevCurrent] = getExplosionProgress(entity);
      const current = prevCurrent + delta * 1000;

      setExplosionCurrent(entity, current);

      if (current >= duration) {
        despawnExplosion(entity);
      }
    });
  };
});
