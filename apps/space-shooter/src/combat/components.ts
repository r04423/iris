import { defineComponent, Type } from "iris-ecs";

export const Bullet = defineComponent("Bullet", {
  schema: {
    speed: Type.f32(),
    dx: Type.f32(),
    dy: Type.f32(),
    lifetime: Type.f32(),
    timeAlive: Type.f32(),
  },
});

export const ShootCooldown = defineComponent("ShootCooldown", {
  schema: {
    cooldown: Type.f32(),
    timer: Type.f32(),
    canShoot: Type.bool(),
  },
});

export const ShieldVisibility = defineComponent("ShieldVisibility", {
  schema: {
    duration: Type.f32(),
    current: Type.f32(),
  },
});

export const CombatConfig = defineComponent("CombatConfig", {
  schema: {
    shootCooldown: Type.f32(),
    bulletRadius: Type.f32(),
    bulletSpawnOffset: Type.f32(),
    bulletSpreadAngle: Type.f32(),
    shieldDuration: Type.f32(),
    shieldBlinkFrequency: Type.f32(),
    shieldRadius: Type.f32(),
  },
});

export const IsBullet = defineComponent("IsBullet");
export const IsShieldVisible = defineComponent("IsShieldVisible");
