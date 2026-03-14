import {
  addSystem,
  createWorld,
  First,
  insertScheduleAfter,
  Last,
  PostUpdate,
  PreUpdate,
  run,
  Startup,
  Update,
} from "iris-ecs";
import { Combat } from "./combat/schedule.js";
import {
  handlePlayerHit,
  handleShooting,
  initCombat,
  pushEnemies,
  tickShieldVisibility,
  updateBulletCollisions,
  updateBullets,
} from "./combat/systems.js";
import {
  followPlayer,
  handleEnemyKilled,
  initEnemies,
  spawnEnemies,
  tickExplosion,
  updateAutoRotate,
  updateAvoidance,
} from "./enemy/systems.js";
import { applyInput, dampPlayerMovement, initInput, readInput, writeInput } from "./input/systems.js";
import { Physics } from "./physics/schedule.js";
import { cleanupSpatialHashMap, initPhysics, updateMovement, updateSpatialHashing } from "./physics/systems.js";
import { initPlayer } from "./player/systems.js";
import { initRenderer, render } from "./render/systems.js";
import { initTime, updateTime } from "./shared/systems.js";

// Pipeline: First -> PreUpdate -> Update -> Combat -> Physics -> PostUpdate -> Last
const world = createWorld();
insertScheduleAfter(world, Combat, Update);
insertScheduleAfter(world, Physics, Combat);

// Startup: each domain initializes its own resources
addSystem(world, initTime, { schedule: Startup });
addSystem(world, initInput, { schedule: Startup });
addSystem(world, initPhysics, { schedule: Startup });
addSystem(world, initCombat, { schedule: Startup });
addSystem(world, initEnemies, { schedule: Startup });
addSystem(world, initRenderer, { schedule: Startup });
addSystem(world, initPlayer, { schedule: Startup });

// First: timing
addSystem(world, updateTime, { schedule: First });

// PreUpdate: input processing
addSystem(world, readInput, { schedule: PreUpdate });
addSystem(world, writeInput, { schedule: PreUpdate });

// Update: AI + player input + interaction
addSystem(world, applyInput, { schedule: Update });
addSystem(world, spawnEnemies, { schedule: Update });
addSystem(world, followPlayer, { schedule: Update });
addSystem(world, dampPlayerMovement, { schedule: Update });
addSystem(world, handleShooting, { schedule: Update });
addSystem(world, updateAvoidance, { schedule: Update });
addSystem(world, updateAutoRotate, { schedule: Update });
addSystem(world, pushEnemies, { schedule: Update });

// Combat: bullet lifecycle + event responses
addSystem(world, updateBullets, { schedule: Combat });
addSystem(world, updateBulletCollisions, { schedule: Combat });
addSystem(world, handlePlayerHit, { schedule: Combat });
addSystem(world, handleEnemyKilled, { schedule: Combat });

// Physics: movement integration + spatial indexing
addSystem(world, updateMovement, { schedule: Physics });
addSystem(world, updateSpatialHashing, { schedule: Physics });
addSystem(world, cleanupSpatialHashMap, { schedule: Physics });

// PostUpdate: animation ticking
addSystem(world, tickShieldVisibility, { schedule: PostUpdate });
addSystem(world, tickExplosion, { schedule: PostUpdate });

// Last: rendering
addSystem(world, render, { schedule: Last });

run(world);
