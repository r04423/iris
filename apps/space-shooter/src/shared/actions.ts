import type { EntityWith } from "iris-ecs";
import { defineActions, getComponentValue, setComponentValue, type World } from "iris-ecs";
import { Movement, Transform, Visual } from "./components.js";

export const transformActions = defineActions((world: World) => ({
  getPosition(entity: EntityWith<typeof Transform>): [number, number] {
    const x = getComponentValue(world, entity, Transform, "x");
    const y = getComponentValue(world, entity, Transform, "y");

    return [x, y];
  },

  setPosition(entity: EntityWith<typeof Transform>, x: number, y: number): void {
    setComponentValue(world, entity, Transform, "x", x);
    setComponentValue(world, entity, Transform, "y", y);
  },

  getRotation(entity: EntityWith<typeof Transform>): number {
    return getComponentValue(world, entity, Transform, "rotation");
  },

  setRotation(entity: EntityWith<typeof Transform>, rotation: number): void {
    setComponentValue(world, entity, Transform, "rotation", rotation);
  },
}));

export const movementActions = defineActions((world: World) => ({
  getVelocity(entity: EntityWith<typeof Movement>): [number, number] {
    const vx = getComponentValue(world, entity, Movement, "vx");
    const vy = getComponentValue(world, entity, Movement, "vy");

    return [vx, vy];
  },

  setVelocity(entity: EntityWith<typeof Movement>, vx: number, vy: number): void {
    setComponentValue(world, entity, Movement, "vx", vx);
    setComponentValue(world, entity, Movement, "vy", vy);
  },

  getForce(entity: EntityWith<typeof Movement>): [number, number] {
    const fx = getComponentValue(world, entity, Movement, "fx");
    const fy = getComponentValue(world, entity, Movement, "fy");

    return [fx, fy];
  },

  setForce(entity: EntityWith<typeof Movement>, fx: number, fy: number): void {
    setComponentValue(world, entity, Movement, "fx", fx);
    setComponentValue(world, entity, Movement, "fy", fy);
  },

  getMaxSpeed(entity: EntityWith<typeof Movement>): number {
    return getComponentValue(world, entity, Movement, "maxSpeed");
  },

  getThrust(entity: EntityWith<typeof Movement>): number {
    return getComponentValue(world, entity, Movement, "thrust");
  },

  getDamping(entity: EntityWith<typeof Movement>): number {
    return getComponentValue(world, entity, Movement, "damping");
  },

  getRotationSpeed(entity: EntityWith<typeof Movement>): number {
    return getComponentValue(world, entity, Movement, "rotationSpeed");
  },
}));

export const visualActions = defineActions((world: World) => ({
  getVisual(entity: EntityWith<typeof Visual>): [number, number] {
    const hue = getComponentValue(world, entity, Visual, "hue");
    const scale = getComponentValue(world, entity, Visual, "scale");

    return [hue, scale];
  },
}));
