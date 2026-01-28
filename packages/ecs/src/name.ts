import { addComponent, getComponentValue, hasComponent, removeComponent, setComponentValue } from "./component.js";
import type { EntityId } from "./encoding.js";
import { registerObserverCallback } from "./observer.js";
import { defineComponent } from "./registry.js";
import { addResource, getResourceValue } from "./resource.js";
import { Type } from "./schema.js";
import type { World } from "./world.js";

// ============================================================================
// Component Definitions
// ============================================================================

/**
 * Name component for entity identification.
 *
 * Stores a single string value that must be unique within the world.
 *
 * @example
 * ```typescript
 * addComponent(world, entity, Name, { value: "player-1" });
 * const name = getComponentValue(world, entity, Name, "value");
 * ```
 */
export const Name = defineComponent("Name", { value: Type.string() });

/**
 * Dual-index registry for O(1) lookups in both directions. Stored as a world resource.
 */
const NameRegistry = defineComponent("NameRegistry", {
  nameToEntity: Type.object<Map<string, EntityId>>(),
  entityToName: Type.object<Map<EntityId, string>>(),
});

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initializes the name system for a world by setting up the dual-index registry
 * and observer callbacks that keep name mappings synchronized with entity lifecycle.
 * Called automatically by createWorld().
 * @internal
 */
export function initNameSystem(world: World): void {
  addResource(world, NameRegistry, {
    nameToEntity: new Map(),
    entityToName: new Map(),
  });

  // Clean up registry when Name component is removed from an entity
  registerObserverCallback(world, "componentRemoved", (componentId, entityId) => {
    if (componentId !== Name) {
      return;
    }

    const nameToEntity = getResourceValue(world, NameRegistry, "nameToEntity")!;
    const entityToName = getResourceValue(world, NameRegistry, "entityToName")!;
    const name = entityToName.get(entityId)!;

    nameToEntity.delete(name);
    entityToName.delete(entityId);
  });

  // Sync registry when Name component is added or its value changes.
  // Validates uniqueness and non-empty constraints before updating mappings.
  registerObserverCallback(world, "componentChanged", (componentId, entityId) => {
    if (componentId !== Name) {
      return;
    }

    const nameToEntity = getResourceValue(world, NameRegistry, "nameToEntity")!;
    const entityToName = getResourceValue(world, NameRegistry, "entityToName")!;
    const previous = entityToName.get(entityId);
    const current = getComponentValue(world, entityId, Name, "value");

    if (previous === current) {
      return;
    }

    if (!current) {
      throw new Error("Name cannot be empty");
    }

    if (nameToEntity.has(current)) {
      throw new Error(`Name "${current}" already exists`);
    }

    // Remove old mapping if renaming an entity
    if (previous !== undefined) {
      nameToEntity.delete(previous);
    }

    nameToEntity.set(current, entityId);
    entityToName.set(entityId, current);
  });

  // Clean up registry when a named entity is destroyed
  registerObserverCallback(world, "entityDestroyed", (entityId) => {
    const nameToEntity = getResourceValue(world, NameRegistry, "nameToEntity")!;
    const entityToName = getResourceValue(world, NameRegistry, "entityToName")!;
    const name = entityToName.get(entityId);

    if (name === undefined) {
      return;
    }

    nameToEntity.delete(name);
    entityToName.delete(entityId);
  });

  // Recreate fresh registry when world is reset
  registerObserverCallback(world, "worldReset", () => {
    addResource(world, NameRegistry, {
      nameToEntity: new Map(),
      entityToName: new Map(),
    });
  });
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Gets the name of an entity.
 * @param world - World instance
 * @param entityId - Entity to get name from
 * @returns Entity name or undefined if not named
 * @example
 * ```ts
 * const name = getName(world, entity);
 * ```
 */
export function getName(world: World, entityId: EntityId): string | undefined {
  return getComponentValue(world, entityId, Name, "value");
}

/**
 * Sets or updates the name of an entity.
 * @param world - World instance
 * @param entityId - Entity to name
 * @param name - Name to assign (must be unique and non-empty)
 * @throws Error if name is empty or already exists
 * @example
 * ```ts
 * setName(world, player, "player-1");
 * ```
 */
export function setName(world: World, entityId: EntityId, name: string): void {
  if (!hasComponent(world, entityId, Name)) {
    addComponent(world, entityId, Name, { value: name });
    return;
  }

  setComponentValue(world, entityId, Name, "value", name);
}

/**
 * Removes the name from an entity.
 * @param world - World instance
 * @param entityId - Entity to remove name from
 * @example
 * ```ts
 * removeName(world, entity);
 * ```
 */
export function removeName(world: World, entityId: EntityId): void {
  if (!hasComponent(world, entityId, Name)) {
    return;
  }

  removeComponent(world, entityId, Name);
}

/**
 * Looks up an entity by name, optionally validating required components.
 * @param world - World instance
 * @param name - Name to look up
 * @param components - Optional components to validate presence
 * @returns Entity ID or undefined if not found or missing required components
 * @example
 * ```ts
 * const player = lookupByName(world, "player-1");
 * const player = lookupByName(world, "player-1", Position, Health);
 * ```
 */
export function lookupByName(world: World, name: string, ...components: EntityId[]): EntityId | undefined {
  const nameToEntity = getResourceValue(world, NameRegistry, "nameToEntity")!;
  const entityId = nameToEntity.get(name);

  if (!entityId) {
    return;
  }

  for (const component of components) {
    if (!hasComponent(world, entityId, component)) {
      return;
    }
  }

  return entityId;
}
