import { defineComponent, Type } from "iris-ecs";

export const Avoidance = defineComponent("Avoidance", {
  schema: {
    range: Type.f32(),
  },
});

export const AutoRotate = defineComponent("AutoRotate", {
  schema: {
    speed: Type.f32(),
  },
});

export const Explosion = defineComponent("Explosion", {
  schema: {
    duration: Type.f32(),
    current: Type.f32(),
    count: Type.i32(),
    rotationOffset: Type.f32(),
    maxRadius: Type.f32(),
  },
});

export const EnemySpawner = defineComponent("EnemySpawner", {
  schema: {
    interval: Type.f32(),
    accumulatedTime: Type.f32(),
    max: Type.i32(),
  },
});

export const EnemyConfig = defineComponent("EnemyConfig", {
  schema: {
    radius: Type.f32(),
    spawnRadiusMin: Type.f32(),
    spawnRadiusMax: Type.f32(),
  },
});

export const IsEnemy = defineComponent("IsEnemy");
export const IsExplosion = defineComponent("IsExplosion");
