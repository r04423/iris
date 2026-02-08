import {
  addComponent,
  type Component,
  createEntity,
  createWorld,
  type EntityId,
  fetchEntities,
  not,
  type Tag,
  type World,
} from "iris-ecs";
import type { PresetFactory, PresetName } from "../../types.js";
import { generateComponents, generateTags } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Deterministic PRNG — splitmix32
// ---------------------------------------------------------------------------

/** Seeded RNG so preset population is reproducible across runs. */
function splitmix32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x9e3779b9) | 0;
    let t = seed ^ (seed >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return (t >>> 0) / 0xffffffff;
  };
}

// ---------------------------------------------------------------------------
// Population helpers
// ---------------------------------------------------------------------------

/**
 * Assigns each entity a semi-random subset of registered types so the world
 * contains multiple archetypes — realistic fragmentation rather than one
 * monolithic archetype with every entity sharing the same component set.
 */
function populateEntities(world: World, count: number, components: Component[], tags: Tag[], seed: number): void {
  const rng = splitmix32(seed);
  const allTypes: EntityId[] = [...components, ...tags];
  const componentSet = new Set<EntityId>(components);

  for (let i = 0; i < count; i++) {
    const entity = createEntity(world);
    const typeCount = 2 + Math.floor(rng() * 5);
    for (let j = 0; j < typeCount; j++) {
      const typeIdx = Math.floor(rng() * allTypes.length);
      const type = allTypes[typeIdx]!;
      if (componentSet.has(type)) {
        // biome-ignore lint/suspicious/noExplicitAny: generated components have { v: f32 } schema
        addComponent(world, entity, type as any, { v: rng() });
      } else {
        addComponent(world, entity, type as Tag);
      }
    }
  }
}

/**
 * Pre-executes randomized queries to populate the internal query cache and
 * archetype matching structures. This simulates a world where multiple systems
 * have already registered diverse queries — benchmarks then run against
 * realistic cache pressure rather than an empty query index.
 */
function activateQueries(world: World, count: number, components: Component[], tags: Tag[], seed: number): void {
  const rng = splitmix32(seed);
  const allTypes: EntityId[] = [...components, ...tags];

  for (let i = 0; i < count; i++) {
    const termCount = 1 + Math.floor(rng() * 3);
    const terms: EntityId[] = [];
    // First term must be an include (queries require at least one)
    const firstIdx = Math.floor(rng() * allTypes.length);
    terms.push(allTypes[firstIdx]!);
    for (let j = 1; j < termCount; j++) {
      const typeIdx = Math.floor(rng() * allTypes.length);
      const type = allTypes[typeIdx]!;
      if (rng() < 0.2) {
        // ~20% chance of not() modifier
        terms.push(not(type) as unknown as EntityId);
      } else {
        terms.push(type);
      }
    }
    // biome-ignore lint/suspicious/noExplicitAny: benchmark infrastructure
    const iter = fetchEntities(world, ...(terms as any));
    for (const _e of iter) {
      /* drain to activate query */
    }
  }
}

// ---------------------------------------------------------------------------
// Pre-generated component/tag registrations
// ---------------------------------------------------------------------------

/**
 * Component and tag definitions are global singletons in iris-ecs. Generating
 * them inside each factory call would exhaust the ID space after a few worlds.
 * We register them once at module load and reuse across all presets.
 */
const xsmallComponents = generateComponents(20);
const xsmallTags = generateTags(20);
const smallComponents = generateComponents(100);
const smallTags = generateTags(100);

// ---------------------------------------------------------------------------
// Preset factories
// ---------------------------------------------------------------------------

/**
 * | Preset | Entities | Component types | Tag types | Queries |
 * |--------|----------|-----------------|-----------|---------|
 * | empty  | 0        | 0               | 0         | 0       |
 * | xsmall | 100      | 20              | 20        | 20      |
 * | small  | 1,000    | 100             | 100       | 100     |
 */

function createEmptyPreset(): World {
  return createWorld();
}

function createXSmallPreset(): World {
  const world = createWorld();
  populateEntities(world, 100, xsmallComponents, xsmallTags, 42);
  activateQueries(world, 20, xsmallComponents, xsmallTags, 123);
  return world;
}

function createSmallPreset(): World {
  const world = createWorld();
  populateEntities(world, 1_000, smallComponents, smallTags, 42);
  activateQueries(world, 100, smallComponents, smallTags, 123);
  return world;
}

export const presets: Record<PresetName, PresetFactory> = {
  empty: createEmptyPreset,
  xsmall: createXSmallPreset,
  small: createSmallPreset,
};
