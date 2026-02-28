import type { World } from "iris-ecs";
import { addResource, defineSystem, ensureQuery, getResourceValue, queryEntities, readEvents, removed } from "iris-ecs";
import { movementActions, transformActions } from "../shared/actions.js";
import { Movement, Time, Transform } from "../shared/components.js";
import { SpatialHashMap } from "../utils/spatial-hash.js";
import { PhysicsConfig, ScratchEntities, SpatialHash } from "./components.js";

// ============================================================================
// Startup
// ============================================================================

export function initPhysics(world: World): void {
  addResource(world, SpatialHash, { map: new SpatialHashMap(50) });
  addResource(world, PhysicsConfig, { forceDamping: 0.95, forceThreshold: 0.01 });
  addResource(world, ScratchEntities, { entities: [] });
}

// ============================================================================
// Physics
// ============================================================================

// Integration order: clamp velocity -> add force -> integrate position -> dampen force.
// Clamping before force addition lets external forces (like push) temporarily
// exceed max speed, which feels more responsive than hard-capping after.
export const updateMovement = defineSystem("updateMovement", (world) => {
  const movers = ensureQuery(world, Transform, Movement);

  const { getPosition, setPosition } = transformActions(world);
  const { getVelocity, setVelocity, getForce, setForce, getMaxSpeed } = movementActions(world);

  return () => {
    const delta = getResourceValue(world, Time, "delta") ?? 0;
    const forceDamping = getResourceValue(world, PhysicsConfig, "forceDamping") ?? 0.95;
    const forceThreshold = getResourceValue(world, PhysicsConfig, "forceThreshold") ?? 0.01;

    queryEntities(world, movers, (entity) => {
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
    });
  };
});

export const updateSpatialHashing = defineSystem("updateSpatialHashing", (world) => {
  const transforms = ensureQuery(world, Transform);

  const { getPosition } = transformActions(world);

  return () => {
    const map = getResourceValue(world, SpatialHash, "map")!;

    queryEntities(world, transforms, (entity) => {
      const [x, y] = getPosition(entity);

      map.setEntity(entity, x, y);
    });
  };
});

// Uses removal events to clean up destroyed entities from the spatial hash.
// removed(Transform) fires when an entity with Transform is destroyed.
export const cleanupSpatialHashMap = defineSystem("cleanupSpatialHashMap", (world) => {
  return () => {
    const map = getResourceValue(world, SpatialHash, "map")!;

    readEvents(world, removed(Transform), (data) => {
      map.removeEntity(data.entity);
    });
  };
});
