import { defineComponent, Type } from "iris-ecs";

// ============================================================================
// Position and Orientation
// ============================================================================

export const Transform = defineComponent("Transform", {
  x: Type.f32(),
  y: Type.f32(),
  rotation: Type.f32(),
});

// ============================================================================
// Physics
// ============================================================================

export const Movement = defineComponent("Movement", {
  vx: Type.f32(),
  vy: Type.f32(),
  fx: Type.f32(),
  fy: Type.f32(),
  thrust: Type.f32(),
  maxSpeed: Type.f32(),
  damping: Type.f32(),
  rotationSpeed: Type.f32(),
});

// ============================================================================
// Appearance
// ============================================================================

export const Visual = defineComponent("Visual", {
  hue: Type.f32(),
  scale: Type.f32(),
});

// ============================================================================
// Timing
// ============================================================================

export const Time = defineComponent("Time", {
  delta: Type.f32(),
  last: Type.f32(),
});
