import {
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
import {
  ALL_POOL_COMPONENTS,
  ALL_POOL_TAGS,
  addEntityTypes,
  GROUP_2,
  GROUP_4,
  GROUP_8,
  generateTemplatePool,
  type TemplateGroup,
} from "./pool.js";
import { splitmix32 } from "./rng.js";

// ============================================================================
// Population helpers
// ============================================================================

/**
 * Populates the world with entities drawn from template groups using
 * power-law weighted cycles. Each group receives a percentage of the
 * total entity count, and within each group entities follow the
 * template weight distribution.
 *
 * When `modifierRate` is provided, a fraction of entities receive
 * 1-3 random modifier types, creating a long tail of variant
 * archetypes beyond the 14 base templates.
 */
function populateFromTemplates(
  world: World,
  count: number,
  distribution: { group: TemplateGroup; share: number }[],
  modifierRate?: number
): void {
  for (const { group, share } of distribution) {
    const groupCount = Math.round(count * share);
    const assignments = generateTemplatePool(groupCount, group, {
      seed: 789,
      modifiers: modifierRate != null ? { rate: modifierRate, seed: 456 } : undefined,
    });
    for (let i = 0; i < groupCount; i++) {
      const entity = createEntity(world);
      addEntityTypes(world, entity, assignments[i]!);
    }
  }
}

/**
 * Pre-executes randomized queries to populate the internal query cache and
 * archetype matching structures. Populates query caches as if multiple systems
 * had registered diverse queries. Benchmarks then run against
 * cache pressure rather than an empty query index.
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

// ============================================================================
// Preset factories
// ============================================================================

/**
 * | Preset | Entities | Group 2 | Group 4 | Group 8 | ~Archetypes | Queries |
 * |--------|----------|---------|---------|---------|-------------|---------|
 * | empty  | 0        | --      | --      | --      | 0           | 0       |
 * | xsmall | 100      | 60%     | 30%     | 10%     | ~38         | 20      |
 * | small  | 1,000    | 50%     | 35%     | 15%     | ~132        | 100     |
 * | medium | 10,000   | 40%     | 40%     | 20%     | ~213        | 400     |
 * | large  | 100,000  | 30%     | 40%     | 30%     | ~229        | 1,000   |
 */

function createEmptyPreset(): World {
  return createWorld();
}

function createXSmallPreset(): World {
  const world = createWorld();
  populateFromTemplates(
    world,
    100,
    [
      { group: GROUP_2, share: 0.6 },
      { group: GROUP_4, share: 0.3 },
      { group: GROUP_8, share: 0.1 },
    ],
    0.1
  );
  activateQueries(world, 20, ALL_POOL_COMPONENTS, ALL_POOL_TAGS, 123);
  return world;
}

function createSmallPreset(): World {
  const world = createWorld();
  populateFromTemplates(
    world,
    1_000,
    [
      { group: GROUP_2, share: 0.5 },
      { group: GROUP_4, share: 0.35 },
      { group: GROUP_8, share: 0.15 },
    ],
    0.05
  );
  activateQueries(world, 100, ALL_POOL_COMPONENTS, ALL_POOL_TAGS, 123);
  return world;
}

function createMediumPreset(): World {
  const world = createWorld();
  populateFromTemplates(
    world,
    10_000,
    [
      { group: GROUP_2, share: 0.4 },
      { group: GROUP_4, share: 0.4 },
      { group: GROUP_8, share: 0.2 },
    ],
    0.012
  );
  activateQueries(world, 400, ALL_POOL_COMPONENTS, ALL_POOL_TAGS, 123);
  return world;
}

function createLargePreset(): World {
  const world = createWorld();
  populateFromTemplates(
    world,
    100_000,
    [
      { group: GROUP_2, share: 0.3 },
      { group: GROUP_4, share: 0.4 },
      { group: GROUP_8, share: 0.3 },
    ],
    0.002
  );
  activateQueries(world, 1_000, ALL_POOL_COMPONENTS, ALL_POOL_TAGS, 123);
  return world;
}

export const presets: Record<PresetName, PresetFactory> = {
  empty: createEmptyPreset,
  xsmall: createXSmallPreset,
  small: createSmallPreset,
  medium: createMediumPreset,
  large: createLargePreset,
};
