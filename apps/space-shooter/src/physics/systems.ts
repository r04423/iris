import { addResource, collectEntities, defineSystem, getResourceValue, readEvents, removed } from "iris-ecs";
import { movementActions, transformActions } from "../shared/actions.js";
import { Movement, Time, Transform } from "../shared/components.js";
import { SpatialHashMap } from "../utils/spatial-hash.js";
import { PhysicsConfig, ScratchEntities, SpatialHash } from "./components.js";

// ============================================================================
// Startup
// ============================================================================

export const initPhysics = defineSystem("initPhysics", (world) => {
  addResource(world, SpatialHash, { map: new SpatialHashMap(50) });
  addResource(world, PhysicsConfig, { forceDamping: 0.95, forceThreshold: 0.01 });
  addResource(world, ScratchEntities, { entities: [] });
});

// ============================================================================
// Physics
// ============================================================================

// Integration order: clamp velocity -> add force -> integrate position -> dampen force.
// Clamping before force addition lets external forces (like push) temporarily
// exceed max speed, which feels more responsive than hard-capping after.
export const updateMovement = defineSystem("updateMovement", (world) => {
  const { getPosition, setPosition } = transformActions(world);
  const { getVelocity, setVelocity, getForce, setForce, getMaxSpeed } = movementActions(world);

  const delta = getResourceValue(world, Time, "delta") ?? 0;
  const forceDamping = getResourceValue(world, PhysicsConfig, "forceDamping") ?? 0.95;
  const forceThreshold = getResourceValue(world, PhysicsConfig, "forceThreshold") ?? 0.01;

  for (const entity of collectEntities(world, [Transform, Movement])) {
    let [vx, vy] = getVelocity(entity);
    const [fx, fy] = getForce(entity);
    const maxSpeed = getMaxSpeed(entity);

    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > maxSpeed) {
      const scale = maxSpeed / speed;
      vx *= scale;
      vy *= scale;
    }

    vx += fx;
    vy += fy;

    const [x, y] = getPosition(entity);

    setPosition(entity, x + vx * delta, y + vy * delta);
    setVelocity(entity, vx, vy);

    // Dampen force toward zero, snapping below threshold to avoid drift
    if (Math.abs(fx) > forceThreshold || Math.abs(fy) > forceThreshold) {
      setForce(entity, fx * forceDamping, fy * forceDamping);
    } else {
      setForce(entity, 0, 0);
    }
  }
});

export const updateSpatialHashing = defineSystem("updateSpatialHashing", (world) => {
  const { getPosition } = transformActions(world);

  const map = getResourceValue(world, SpatialHash, "map")!;

  for (const entity of collectEntities(world, [Transform])) {
    const [x, y] = getPosition(entity);

    map.setEntity(entity, x, y);
  }
});

// Uses removal events to clean up destroyed entities from the spatial hash.
// removed(Transform) fires when an entity with Transform is destroyed.
export const cleanupSpatialHashMap = defineSystem("cleanupSpatialHashMap", (world) => {
  const map = getResourceValue(world, SpatialHash, "map")!;

  readEvents(world, removed(Transform), (data) => {
    map.removeEntity(data.entity);
  });
});
