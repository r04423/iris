import {
  addComponent,
  collectEntities,
  createEntity,
  defineActions,
  destroyEntity,
  type Entity,
  type EntityId,
  getComponentValue,
  pair,
  setComponentValue,
  setName,
  type World,
} from "iris-ecs";
import { Movement, Transform, Visual } from "../shared/components.js";
import { Targeting } from "../shared/relations.js";
import { between } from "../utils/between.js";
import { AutoRotate, Avoidance, Explosion, IsEnemy, IsExplosion } from "./components.js";

export const enemyActions = defineActions((world: World) => {
  let enemyCounter = 0;
  let explosionCounter = 0;

  return {
    // =========================================================================
    // Enemy lifecycle
    // =========================================================================

    spawnEnemy(x: number, y: number, target?: Entity): Entity {
      const entity = createEntity(world);
      setName(world, entity, `Enemy#${++enemyCounter}`);
      addComponent(world, entity, IsEnemy);
      addComponent(world, entity, Transform, { x, y, rotation: 0 });
      addComponent(world, entity, Movement, {
        vx: 0,
        vy: 0,
        fx: 0,
        fy: 0,
        thrust: between(1.5, 2.1),
        maxSpeed: between(20, 35),
        damping: between(0.94, 0.98),
        rotationSpeed: 0,
      });
      addComponent(world, entity, AutoRotate, { speed: between(2, 5) });
      addComponent(world, entity, Avoidance, { range: between(2.0, 3.0) });
      addComponent(world, entity, Visual, {
        hue: between(-20, 20),
        scale: between(0.85, 1.15),
      });

      if (target !== undefined) {
        addComponent(world, entity, pair(Targeting, target));
      }

      return entity;
    },

    despawnEnemy(entity: EntityId): void {
      destroyEntity(world, entity);
    },

    getEnemyCount(): number {
      return collectEntities(world, [IsEnemy]).length;
    },

    // =========================================================================
    // Explosion lifecycle
    // =========================================================================

    spawnExplosion(x: number, y: number): Entity {
      const entity = createEntity(world);
      setName(world, entity, `Explosion#${++explosionCounter}`);
      addComponent(world, entity, IsExplosion);
      addComponent(world, entity, Transform, { x, y, rotation: 0 });
      addComponent(world, entity, Explosion, {
        duration: between(350, 450),
        current: 0,
        count: Math.floor(between(15, 25)),
        rotationOffset: between(0, Math.PI / 3),
        maxRadius: between(25, 35),
      });
      return entity;
    },

    despawnExplosion(entity: EntityId): void {
      destroyEntity(world, entity);
    },

    getExplosionProgress(entity: EntityId): [number, number] {
      const duration = getComponentValue(world, entity, Explosion, "duration") ?? 500;
      const current = getComponentValue(world, entity, Explosion, "current") ?? 0;
      return [duration, current];
    },

    setExplosionCurrent(entity: EntityId, current: number): void {
      setComponentValue(world, entity, Explosion, "current", current);
    },

    getExplosionRotationOffset(entity: EntityId): number {
      return getComponentValue(world, entity, Explosion, "rotationOffset") ?? 0;
    },

    getExplosionMaxRadius(entity: EntityId): number {
      return getComponentValue(world, entity, Explosion, "maxRadius") ?? 30;
    },

    // =========================================================================
    // Component reads
    // =========================================================================

    getAutoRotateSpeed(entity: EntityId): number {
      return getComponentValue(world, entity, AutoRotate, "speed") ?? 1;
    },

    getAvoidanceRange(entity: EntityId): number {
      return getComponentValue(world, entity, Avoidance, "range") ?? 1.5;
    },
  };
});
