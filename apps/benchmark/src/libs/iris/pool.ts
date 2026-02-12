import { addComponent, type Component, type Entity, type EntityId, type Tag, type World } from "iris-ecs";
import { GENERATED_COMPONENTS, GENERATED_TAGS } from "./fixtures.js";
import { splitmix32 } from "./rng.js";

// ============================================================================
// Template types
// ============================================================================

/** A fixed entity archetype: a named set of types with a power-law weight. */
export type Template = {
  name: string;
  types: EntityId[];
  /** First component (not tag) in the types array, used for get/set benchmarks. */
  componentTarget: Component;
  weight: number;
};

/**
 * A group of templates with the same width (number of types per entity).
 * Contains a pre-expanded weighted cycle for deterministic assignment.
 */
export type TemplateGroup = {
  width: number;
  templates: Template[];
  /** Expanded cycle: template refs repeated by weight. */
  cycle: Template[];
};

/**
 * Per-entity assignment produced by `generateTemplatePool`.
 * Carries pre-resolved targets so benchmark hot loops need zero lookups.
 */
export type TemplateAssignment = {
  template: Template;
  /** Target for add benchmarks (never in any template). */
  addTarget: Component;
  /** Target for remove benchmarks (random type from the template). */
  removeTarget: EntityId;
  /** Target for has benchmarks (random type from the template). */
  hasTarget: EntityId;
  /** Target for get/set benchmarks (random component from the template). */
  componentTarget: Component;
  /** Optional modifier types added to this entity (sorted for deterministic archetype identity). */
  modifiers: EntityId[];
};

/**
 * Configuration for the modifier system that creates archetype fragmentation.
 * Modifiers are optional types (components/tags) added to a fraction of entities
 * during preset population, producing variant archetypes beyond the base templates.
 */
export type ModifierConfig = {
  /** Probability that an entity receives modifiers (0..1). */
  rate: number;
  /** RNG seed for reproducible modifier assignment. */
  seed: number;
};

/** Options for `generateTemplatePool`. */
export type PoolOptions = {
  /** Seed for randomized template selection and target assignment. */
  seed?: number;
  /** Modifier configuration for archetype fragmentation during preset population. */
  modifiers?: ModifierConfig;
};

// ============================================================================
// Shorthand aliases
// ============================================================================

const C = GENERATED_COMPONENTS;
const T = GENERATED_TAGS;

/** O(1) discrimination between component and tag types (includes modifier components). */
const componentSet = new Set<EntityId>([...GENERATED_COMPONENTS]);

/** Component used for empty-entity add benchmarks. Never in any template. */
export const ADD_TARGET = C[99]!;

/** Pool of add-target components (C[95..99]). None appear in any template or modifier. */
const ADD_TARGETS: Component[] = [C[95]!, C[96]!, C[97]!, C[98]!, C[99]!] as Component[];

export const POOL_SIZE = 10_240;

// ============================================================================
// Modifier pool
// ============================================================================

/** 10 data-bearing modifier components (C[30..39]). */
export const MODIFIER_COMPONENTS: Component[] = C.slice(30, 40) as Component[];

/** 10 marker modifier tags (T[22..31]). */
export const MODIFIER_TAGS: Tag[] = T.slice(22, 32) as Tag[];

/** Combined pool of 20 modifier types for random assignment. */
export const MODIFIER_POOL: EntityId[] = [...MODIFIER_COMPONENTS, ...MODIFIER_TAGS];

// ============================================================================
// Template definitions
// ============================================================================

function tpl(name: string, types: EntityId[], weight: number): Template {
  const componentTarget = types.find((t) => componentSet.has(t))! as Component;
  return { name, types, weight, componentTarget };
}

// Group 2: 4 templates (static/simple entities)
const GROUP_2_TEMPLATES: Template[] = [
  tpl("Particle", [C[0]!, C[1]!], 8),
  tpl("AudioSource", [C[0]!, C[2]!], 4),
  tpl("Trigger", [C[0]!, T[0]!], 2),
  tpl("Waypoint", [C[0]!, T[1]!], 1),
];

// Group 4: 5 templates (moving/interactive entities)
const GROUP_4_TEMPLATES: Template[] = [
  tpl("Prop", [C[0]!, C[3]!, C[4]!, T[2]!], 16),
  tpl("Projectile", [C[0]!, C[1]!, C[5]!, T[3]!], 8),
  tpl("Pickup", [C[0]!, C[6]!, T[4]!, T[5]!], 6),
  tpl("Light", [C[0]!, C[7]!, C[8]!, T[6]!], 4),
  tpl("Decal", [C[0]!, C[9]!, T[7]!, T[8]!], 4),
];

// Group 8: 5 templates (complex entities)
const GROUP_8_TEMPLATES: Template[] = [
  tpl("Player", [C[0]!, C[1]!, C[10]!, C[11]!, C[12]!, C[13]!, T[9]!, T[10]!], 1),
  tpl("Enemy", [C[0]!, C[1]!, C[14]!, C[15]!, C[16]!, T[11]!, T[12]!, T[13]!], 16),
  tpl("NPC", [C[0]!, C[10]!, C[17]!, C[18]!, C[19]!, T[14]!, T[15]!, T[16]!], 8),
  tpl("Vehicle", [C[0]!, C[20]!, C[21]!, C[22]!, C[23]!, T[17]!, T[18]!, T[19]!], 4),
  tpl("Boss", [C[0]!, C[1]!, C[24]!, C[25]!, C[26]!, C[27]!, T[20]!, T[21]!], 8),
];

function buildCycle(templates: Template[]): Template[] {
  const cycle: Template[] = [];
  for (let i = 0; i < templates.length; i++) {
    const t = templates[i]!;
    for (let j = 0; j < t.weight; j++) {
      cycle.push(t);
    }
  }
  return cycle;
}

export const GROUP_2: TemplateGroup = {
  width: 2,
  templates: GROUP_2_TEMPLATES,
  cycle: buildCycle(GROUP_2_TEMPLATES),
};

export const GROUP_4: TemplateGroup = {
  width: 4,
  templates: GROUP_4_TEMPLATES,
  cycle: buildCycle(GROUP_4_TEMPLATES),
};

export const GROUP_8: TemplateGroup = {
  width: 8,
  templates: GROUP_8_TEMPLATES,
  cycle: buildCycle(GROUP_8_TEMPLATES),
};

export const GROUPS: TemplateGroup[] = [GROUP_2, GROUP_4, GROUP_8];

// ============================================================================
// All pool types (for query activation)
// ============================================================================

/** All unique components used across all templates and modifiers. */
export const ALL_POOL_COMPONENTS: Component[] = (() => {
  const seen = new Set<EntityId>();
  const result: Component[] = [];
  for (const group of GROUPS) {
    for (const template of group.templates) {
      for (const type of template.types) {
        if (componentSet.has(type) && !seen.has(type)) {
          seen.add(type);
          result.push(type as Component);
        }
      }
    }
  }
  for (const comp of MODIFIER_COMPONENTS) {
    if (!seen.has(comp)) {
      seen.add(comp);
      result.push(comp);
    }
  }
  return result;
})();

/** All unique tags used across all templates and modifiers. */
export const ALL_POOL_TAGS: Tag[] = (() => {
  const seen = new Set<EntityId>();
  const result: Tag[] = [];
  for (const group of GROUPS) {
    for (const template of group.templates) {
      for (const type of template.types) {
        if (!componentSet.has(type) && !seen.has(type)) {
          seen.add(type);
          result.push(type as Tag);
        }
      }
    }
  }
  for (const tag of MODIFIER_TAGS) {
    if (!seen.has(tag)) {
      seen.add(tag);
      result.push(tag);
    }
  }
  return result;
})();

// ============================================================================
// Modifier helpers
// ============================================================================

/**
 * Rolls how many modifiers an entity receives.
 * Distribution: 75% get 1, 20% get 2, 5% get 3.
 * Returns 0 if the entity doesn't pass the rate check.
 */
function rollModifierCount(rng: () => number, rate: number): number {
  if (rng() >= rate) return 0;
  const r = rng();
  if (r < 0.75) return 1;
  if (r < 0.95) return 2;
  return 3;
}

/**
 * Picks `count` unique modifiers from `MODIFIER_POOL`, sorted by numeric
 * value for deterministic archetype identity.
 */
function pickModifiers(rng: () => number, count: number): EntityId[] {
  const pool = MODIFIER_POOL;
  const picked: EntityId[] = [];
  const used = new Set<number>();
  while (picked.length < count) {
    const idx = Math.floor(rng() * pool.length);
    if (!used.has(idx)) {
      used.add(idx);
      picked.push(pool[idx]!);
    }
  }
  // Sort numerically for deterministic archetype identity
  picked.sort((a, b) => (a as number) - (b as number));
  return picked;
}

// ============================================================================
// Pool generation
// ============================================================================

/**
 * Generates `count` template assignments from the group's weighted cycle.
 *
 * When `options.seed` is provided, template selection and per-assignment
 * targets (add/remove/has/get/set) are randomized via seeded RNG to simulate
 * non-deterministic spawning and access patterns.
 *
 * When `options.modifiers` is provided, a fraction of entities receive 1-3
 * random modifier types that create variant archetypes.
 */
export function generateTemplatePool(count: number, group: TemplateGroup, options?: PoolOptions): TemplateAssignment[] {
  const assignments: TemplateAssignment[] = [];
  const { cycle } = group;
  const seed = options?.seed;
  const modifierConfig = options?.modifiers;

  const rng = seed != null ? splitmix32(seed) : undefined;
  const modRng = modifierConfig ? splitmix32(modifierConfig.seed) : undefined;
  const rate = modifierConfig?.rate ?? 0;

  for (let i = 0; i < count; i++) {
    const template = rng ? cycle[Math.floor(rng() * cycle.length)]! : cycle[i % cycle.length]!;

    const modifiers = modRng ? pickModifiers(modRng, rollModifierCount(modRng, rate)) : [];

    let addTarget: Component;
    let removeTarget: EntityId;
    let hasTarget: EntityId;
    let componentTarget: Component;

    if (rng) {
      const types = template.types;
      const comps = types.filter((t) => componentSet.has(t)) as Component[];
      addTarget = ADD_TARGETS[Math.floor(rng() * ADD_TARGETS.length)]!;
      removeTarget = types[Math.floor(rng() * types.length)]!;
      hasTarget = types[Math.floor(rng() * types.length)]!;
      componentTarget = comps[Math.floor(rng() * comps.length)]!;
    } else {
      addTarget = ADD_TARGET;
      removeTarget = template.types[template.types.length - 1]!;
      hasTarget = template.types[0]!;
      componentTarget = template.componentTarget;
    }

    assignments.push({
      template,
      addTarget,
      removeTarget,
      hasTarget,
      componentTarget,
      modifiers,
    });
  }
  return assignments;
}

// ============================================================================
// Entity population
// ============================================================================

/**
 * Adds a template's types to an entity. Components get `{ v: 0 }` data;
 * tags get no data.
 */
export function addTemplateTypes(world: World, entity: Entity, template: Template): void {
  for (let i = 0; i < template.types.length; i++) {
    const type = template.types[i]!;
    if (componentSet.has(type)) {
      // biome-ignore lint/suspicious/noExplicitAny: all pool components share { v: f32 } schema
      addComponent(world, entity, type as any, { v: 0 });
    } else {
      addComponent(world, entity, type as Tag);
    }
  }
}

/**
 * Adds a template's types plus any modifier types to an entity.
 * Used during preset population to create archetype fragmentation.
 */
export function addEntityTypes(world: World, entity: Entity, assignment: TemplateAssignment): void {
  addTemplateTypes(world, entity, assignment.template);
  for (let i = 0; i < assignment.modifiers.length; i++) {
    const type = assignment.modifiers[i]!;
    if (componentSet.has(type)) {
      // biome-ignore lint/suspicious/noExplicitAny: all pool components share { v: f32 } schema
      addComponent(world, entity, type as any, { v: 0 });
    } else {
      addComponent(world, entity, type as Tag);
    }
  }
}
