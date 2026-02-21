import { defineComponent, defineTag, Type } from "iris-ecs";

export const Bullet = defineComponent("Bullet", {
  speed: Type.f32(),
  dx: Type.f32(),
  dy: Type.f32(),
  lifetime: Type.f32(),
  timeAlive: Type.f32(),
});

export const ShootCooldown = defineComponent("ShootCooldown", {
  cooldown: Type.f32(),
  timer: Type.f32(),
  canShoot: Type.bool(),
});

export const ShieldVisibility = defineComponent("ShieldVisibility", {
  duration: Type.f32(),
  current: Type.f32(),
});

export const CombatConfig = defineComponent("CombatConfig", {
  shootCooldown: Type.f32(),
  bulletRadius: Type.f32(),
  bulletSpawnOffset: Type.f32(),
  bulletSpreadAngle: Type.f32(),
  shieldDuration: Type.f32(),
  shieldBlinkFrequency: Type.f32(),
  shieldRadius: Type.f32(),
});

export const IsBullet = defineTag("IsBullet");
export const IsShieldVisible = defineTag("IsShieldVisible");
