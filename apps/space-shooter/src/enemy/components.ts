import { defineComponent, defineTag, Type } from "iris-ecs";

export const Avoidance = defineComponent("Avoidance", {
  range: Type.f32(),
});

export const AutoRotate = defineComponent("AutoRotate", {
  speed: Type.f32(),
});

export const Explosion = defineComponent("Explosion", {
  duration: Type.f32(),
  current: Type.f32(),
  count: Type.i32(),
  rotationOffset: Type.f32(),
  maxRadius: Type.f32(),
});

export const EnemySpawner = defineComponent("EnemySpawner", {
  interval: Type.f32(),
  accumulatedTime: Type.f32(),
  max: Type.i32(),
});

export const EnemyConfig = defineComponent("EnemyConfig", {
  radius: Type.f32(),
  spawnRadiusMin: Type.f32(),
  spawnRadiusMax: Type.f32(),
});

export const IsEnemy = defineTag("IsEnemy");
export const IsExplosion = defineTag("IsExplosion");
