import { addComponent, getComponentValue, hasComponent, removeComponent, setComponentValue } from "./component.js";
import type { EntityId, EntityWith } from "./encoding.js";
import { assert, IrisDuplicate, IrisInvalidArgument } from "./error.js";
import { registerObserverCallback } from "./observer.js";
import { defineComponent } from "./registry.js";
import { Type } from "./schema.js";
import type { World } from "./world.js";

// ============================================================================
// Component Definitions
// ============================================================================

/**
 * Name component for entity identification.
 *
 * Stores a single string value that must be unique within the world. Set it via
 * {@link setName}, which enforces those constraints.
 *
 * @example
 * ```typescript
 * setName(world, entity, "player-1");
 * const name = getName(world, entity);
 * ```
 */
export const Name = defineComponent("Name", { value: Type.string() });

// ============================================================================
// Initialization
// ============================================================================

/**
 * Clears the world's name indices.
 * @param world - World instance to initialize
 * @internal
 */
export function resetNameSystem(world: World): void {
  world.entities.byName.clear();
  world.entities.names.clear();
}

/**
 * Initializes the name system for a world by registering the observer callbacks
 * that keep the name indices synchronized with entity lifecycle.
 * Called automatically by createWorld().
 * @internal
 */
export function initNameSystem(world: World): void {
  // Clean up indices when Name component is removed from an entity
  registerObserverCallback(world, "componentRemoved", (componentId, entityId) => {
    if (componentId !== Name) {
      return;
    }

    const { byName, names } = world.entities;
    const name = names.get(entityId)!;

    byName.delete(name);
    names.delete(entityId);
  });

  // Sync indices when Name component is added or its value changes.
  // Validates uniqueness and non-empty constraints before updating mappings.
  registerObserverCallback(world, "componentChanged", (componentId, entityId) => {
    if (componentId !== Name) {
      return;
    }

    const { byName: nameToEntity, names: entityToName } = world.entities;
    const previous = entityToName.get(entityId);
    const current = getComponentValue(world, entityId, Name, "value");

    if (previous === current) {
      return;
    }

    assert(current, IrisInvalidArgument, { expected: "non-empty name" });
    assert(!nameToEntity.has(current), IrisDuplicate, { resource: "Name", id: current });

    // Remove old mapping if renaming an entity
    if (previous !== undefined) {
      nameToEntity.delete(previous);
    }

    nameToEntity.set(current, entityId);
    entityToName.set(entityId, current);
  });

  // Clean up indices when a named entity is destroyed
  registerObserverCallback(world, "entityDestroyed", (entityId) => {
    const { byName, names } = world.entities;
    const name = names.get(entityId);

    if (name === undefined) {
      return;
    }

    byName.delete(name);
    names.delete(entityId);
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
 * @throws {IrisInvalidArgument} If name is empty
 * @throws {IrisDuplicate} If name already exists
 * @example
 * ```ts
 * setName(world, player, "player-1");
 * ```
 */
export function setName(world: World, entityId: EntityId, name: string): void {
  assert(name, IrisInvalidArgument, { expected: "non-empty name" });

  if (getName(world, entityId) === name) {
    return;
  }

  assert(lookupByName(world, name) === undefined, IrisDuplicate, { resource: "Name", id: name });

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
 * const player = lookupByName(world, "player-1", [Position, Health]);
 * ```
 */
export function lookupByName<C extends EntityId[]>(
  world: World,
  name: string,
  components?: C
): EntityWith<C[number]> | undefined {
  const entityId = world.entities.byName.get(name);

  if (!entityId) {
    return;
  }

  for (const component of components ?? []) {
    if (!hasComponent(world, entityId, component)) {
      return;
    }
  }

  return entityId as EntityWith<C[number]>;
}
