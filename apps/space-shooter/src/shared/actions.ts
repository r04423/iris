import type { EntityId } from "iris-ecs";
import { defineActions, getComponentValue, setComponentValue, type World } from "iris-ecs";
import { Movement, Transform, Visual } from "./components.js";

export const transformActions = defineActions((world: World) => ({
  getPosition(entity: EntityId): [number, number] {
    const x = getComponentValue(world, entity, Transform, "x") ?? 0;
    const y = getComponentValue(world, entity, Transform, "y") ?? 0;

    return [x, y];
  },

  setPosition(entity: EntityId, x: number, y: number): void {
    setComponentValue(world, entity, Transform, "x", x);
    setComponentValue(world, entity, Transform, "y", y);
  },

  getRotation(entity: EntityId): number {
    return getComponentValue(world, entity, Transform, "rotation") ?? 0;
  },

  setRotation(entity: EntityId, rotation: number): void {
    setComponentValue(world, entity, Transform, "rotation", rotation);
  },
}));

export const movementActions = defineActions((world: World) => ({
  getVelocity(entity: EntityId): [number, number] {
    const vx = getComponentValue(world, entity, Movement, "vx") ?? 0;
    const vy = getComponentValue(world, entity, Movement, "vy") ?? 0;

    return [vx, vy];
  },

  setVelocity(entity: EntityId, vx: number, vy: number): void {
    setComponentValue(world, entity, Movement, "vx", vx);
    setComponentValue(world, entity, Movement, "vy", vy);
  },

  getForce(entity: EntityId): [number, number] {
    const fx = getComponentValue(world, entity, Movement, "fx") ?? 0;
    const fy = getComponentValue(world, entity, Movement, "fy") ?? 0;

    return [fx, fy];
  },

  setForce(entity: EntityId, fx: number, fy: number): void {
    setComponentValue(world, entity, Movement, "fx", fx);
    setComponentValue(world, entity, Movement, "fy", fy);
  },

  getMaxSpeed(entity: EntityId): number {
    return getComponentValue(world, entity, Movement, "maxSpeed") ?? 10;
  },

  getThrust(entity: EntityId): number {
    return getComponentValue(world, entity, Movement, "thrust") ?? 0;
  },

  getDamping(entity: EntityId): number {
    return getComponentValue(world, entity, Movement, "damping") ?? 0.98;
  },

  getRotationSpeed(entity: EntityId): number {
    return getComponentValue(world, entity, Movement, "rotationSpeed") ?? 0;
  },
}));

export const visualActions = defineActions((world: World) => ({
  getVisual(entity: EntityId): [number, number] {
    const hue = getComponentValue(world, entity, Visual, "hue") ?? 0;
    const scale = getComponentValue(world, entity, Visual, "scale") ?? 1;

    return [hue, scale];
  },
}));
