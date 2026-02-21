import type { World } from "iris-ecs";
import { addResource, getResourceValue, queryEntities } from "iris-ecs";
import { combatActions } from "../combat/actions.js";
import { CombatConfig, IsBullet } from "../combat/components.js";
import { enemyActions } from "../enemy/actions.js";
import { Explosion, IsEnemy, IsExplosion } from "../enemy/components.js";
import { IsPlayer } from "../player/components.js";
import { movementActions, transformActions, visualActions } from "../shared/actions.js";
import { Movement, Transform, Visual } from "../shared/components.js";
import { RendererResource } from "./components.js";
import { GameRenderer } from "./renderer.js";

// ============================================================================
// Startup
// ============================================================================

export function initRenderer(world: World): void {
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const instance = new GameRenderer(canvas);

  addResource(world, RendererResource, { instance });
}

// ============================================================================
// Last
// ============================================================================

// Thin bridge: queries ECS for entity data, passes plain values to GameRenderer.
// Draw order matters -- enemies first, then bullets, explosions, player on top.
export function render(world: World): void {
  const renderer = getResourceValue(world, RendererResource, "instance")!;
  const shieldRadius = getResourceValue(world, CombatConfig, "shieldRadius") ?? 28;

  const { getPosition, getRotation } = transformActions(world);
  const { getVelocity } = movementActions(world);
  const { getVisual } = visualActions(world);
  const { getBulletDirection } = combatActions(world);
  const { getExplosionProgress, getExplosionRotationOffset, getExplosionMaxRadius } = enemyActions(world);
  const { isShieldVisible } = combatActions(world);

  renderer.beginFrame();

  // Enemies
  queryEntities(world, [IsEnemy, Transform, Visual], (entity) => {
    const [x, y] = getPosition(entity);
    const rotation = getRotation(entity);
    const [hue, scale] = getVisual(entity);

    renderer.drawEnemy(x, y, rotation, hue, scale);
  });

  // Bullets
  queryEntities(world, [IsBullet, Transform], (entity) => {
    const [x, y] = getPosition(entity);
    const [dx, dy] = getBulletDirection(entity);

    renderer.drawBullet(x, y, dx, dy);
  });

  // Explosions
  queryEntities(world, [IsExplosion, Transform, Explosion], (entity) => {
    const [x, y] = getPosition(entity);
    const [duration, current] = getExplosionProgress(entity);
    const rotationOffset = getExplosionRotationOffset(entity);
    const maxRadius = getExplosionMaxRadius(entity);

    const progress = current / duration;

    renderer.drawExplosion(x, y, progress, rotationOffset, maxRadius);
  });

  // Player
  queryEntities(world, [IsPlayer, Transform, Movement], (entity) => {
    const [x, y] = getPosition(entity);
    const rotation = getRotation(entity);
    const [vx, vy] = getVelocity(entity);
    const speed = Math.sqrt(vx * vx + vy * vy);

    renderer.drawPlayer(x, y, rotation, speed);

    if (isShieldVisible(entity)) {
      renderer.drawShield(x, y, shieldRadius);
    }
  });

  renderer.endFrame();
}
