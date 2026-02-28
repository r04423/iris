import {
  addResource,
  defineSystem,
  emitEvent,
  ensureQuery,
  getResourceValue,
  queryEntities,
  readEvents,
  type World,
} from "iris-ecs";
import { IsPlayer } from "../player/components.js";
import { movementActions, transformActions } from "../shared/actions.js";
import { Movement, Time, Transform } from "../shared/components.js";
import { inputActions } from "./actions.js";
import { Input, InputState } from "./components.js";
import { KeyDown, KeyUp, MouseButtonDown, MouseButtonUp } from "./events.js";

// ============================================================================
// Startup
// ============================================================================

// Three-layer input pipeline:
// 1. DOM listeners emit events (no game state mutation)
// 2. readInput drains events into InputState resource (processed state)
// 3. writeInput maps InputState -> per-entity Input component (game-facing)
export function initInput(world: World): void {
  addResource(world, InputState, { state: { keys: new Set<string>(), mouseButton: false } });

  const canvas = document.getElementById("game") as HTMLCanvasElement;

  window.addEventListener("keydown", (e) => {
    emitEvent(world, KeyDown, { key: e.key.toLowerCase() });
    if (e.key === " " || e.key.startsWith("Arrow")) {
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    emitEvent(world, KeyUp, { key: e.key.toLowerCase() });
  });
  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) emitEvent(world, MouseButtonDown);
  });
  canvas.addEventListener("mouseup", (e) => {
    if (e.button === 0) emitEvent(world, MouseButtonUp);
  });
}

// ============================================================================
// PreUpdate
// ============================================================================

// Drains input events into persistent state. readEvents picks up between-frame
// DOM events because emitEvent timestamps them with the current tick and
// readEvents scans (lastTick, tick].
export const readInput = defineSystem("readInput", (world) => {
  return () => {
    const state = getResourceValue(world, InputState, "state")!;

    readEvents(world, KeyDown, (data) => {
      state.keys.add(data.key);
    });
    readEvents(world, KeyUp, (data) => {
      state.keys.delete(data.key);
    });
    readEvents(world, MouseButtonDown, () => {
      state.mouseButton = true;
    });
    readEvents(world, MouseButtonUp, () => {
      state.mouseButton = false;
    });
  };
});

// Maps InputState -> per-entity Input component so downstream systems
// can read simple scalar fields instead of querying raw key state.
export const writeInput = defineSystem("writeInput", (world) => {
  const players = ensureQuery(world, IsPlayer, Input);

  const { setInput } = inputActions(world);

  return () => {
    const state = getResourceValue(world, InputState, "state")!;

    queryEntities(world, players, (entity) => {
      const thrust =
        (state.keys.has("w") || state.keys.has("arrowup") ? 1 : 0) -
        (state.keys.has("s") || state.keys.has("arrowdown") ? 1 : 0);
      const turn =
        (state.keys.has("d") || state.keys.has("arrowright") ? 1 : 0) -
        (state.keys.has("a") || state.keys.has("arrowleft") ? 1 : 0);
      const fire = state.keys.has(" ") || state.mouseButton ? 1 : 0;

      setInput(entity, thrust, turn, fire);
    });
  };
});

// ============================================================================
// Update
// ============================================================================

export const applyInput = defineSystem("applyInput", (world) => {
  const players = ensureQuery(world, IsPlayer, Input, Movement, Transform);

  const { getRotation, setRotation } = transformActions(world);
  const { getVelocity, setVelocity, getRotationSpeed, getThrust, getMaxSpeed } = movementActions(world);
  const { getInputThrust, getInputTurn } = inputActions(world);

  return () => {
    const delta = getResourceValue(world, Time, "delta") ?? 0;

    queryEntities(world, players, (entity) => {
      const thrustInput = getInputThrust(entity);
      const turnInput = getInputTurn(entity);

      const rotationSpeed = getRotationSpeed(entity);
      const rotation = getRotation(entity);
      const newRotation = rotation + turnInput * rotationSpeed * delta;
      setRotation(entity, newRotation);

      if (thrustInput !== 0) {
        const thrust = getThrust(entity);
        const maxSpeed = getMaxSpeed(entity);

        const dirX = Math.sin(newRotation);
        const dirY = Math.cos(newRotation);

        let [vx, vy] = getVelocity(entity);

        vx += dirX * thrustInput * thrust * delta;
        vy += dirY * thrustInput * thrust * delta;

        const speed = Math.sqrt(vx * vx + vy * vy);
        if (speed > maxSpeed) {
          const scale = maxSpeed / speed;
          vx *= scale;
          vy *= scale;
        }

        setVelocity(entity, vx, vy);
      }
    });
  };
});

export const dampPlayerMovement = defineSystem("dampPlayerMovement", (world) => {
  const entities = ensureQuery(world, Movement, Input);

  const { getVelocity, setVelocity, getDamping } = movementActions(world);
  const { getInputThrust } = inputActions(world);

  return () => {
    queryEntities(world, entities, (entity) => {
      const thrustInput = getInputThrust(entity);

      if (thrustInput === 0) {
        const damping = getDamping(entity);
        const [vx, vy] = getVelocity(entity);

        setVelocity(entity, vx * damping, vy * damping);
      }
    });
  };
});
