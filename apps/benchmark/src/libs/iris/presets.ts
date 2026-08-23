import { createEntity, createWorld, not, type QueryTerm, queryFirstEntity, type World } from "iris-ecs";
import type { PresetFactory, PresetName } from "../../types.js";
import {
  addEntityTypes,
  GROUP_2,
  GROUP_4,
  GROUP_8,
  GROUPS,
  generateTemplatePool,
  MODIFIER_POOL,
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
 * Pre-executes template-derived queries to populate the internal query cache
 * and archetype matching structures. Each query is built by picking a random
 * template and selecting 1-3 of its types as terms, with a chance of adding
 * a modifier type (include or `not()`). This produces realistic cache pressure
 * since queries target component sets that actually co-occur on entities.
 */
function activateQueries(world: World, count: number, seed: number): void {
  const rng = splitmix32(seed);
  const allTemplates = GROUPS.flatMap((g) => g.templates);

  for (let i = 0; i < count; i++) {
    const template = allTemplates[Math.floor(rng() * allTemplates.length)]!;
    const types = template.types;

    // 1-3 terms drawn from the template's own types
    const maxTerms = Math.min(3, types.length);
    const termCount = 1 + Math.floor(rng() * maxTerms);
    const terms: QueryTerm[] = [];
    const used = new Set<number>();

    for (let j = 0; j < termCount; j++) {
      let idx: number;
      do {
        idx = Math.floor(rng() * types.length);
      } while (used.has(idx));
      used.add(idx);
      terms.push(types[idx]!);
    }

    // ~20% chance of adding a modifier term (include or not())
    if (rng() < 0.2) {
      const modifier = MODIFIER_POOL[Math.floor(rng() * MODIFIER_POOL.length)]!;
      if (rng() < 0.5) {
        terms.push(not(modifier));
      } else {
        terms.push(modifier);
      }
    }

    queryFirstEntity(world, terms);
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
  activateQueries(world, 20, 123);
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
  activateQueries(world, 100, 123);
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
  activateQueries(world, 400, 123);
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
  activateQueries(world, 1_000, 123);
  return world;
}

export const presets: Record<PresetName, PresetFactory> = {
  empty: createEmptyPreset,
  xsmall: createXSmallPreset,
  small: createSmallPreset,
  medium: createMediumPreset,
  large: createLargePreset,
};
