import { defineEvent, Type } from "iris-ecs";

export const EnemyKilled = defineEvent("EnemyKilled", {
  x: Type.f32(),
  y: Type.f32(),
});

export const PlayerHit = defineEvent("PlayerHit");
