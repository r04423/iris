import { addComponent, getComponentValue, hasComponent, removeComponent, setComponentValue } from "./component.js";
import type { EntityId, EntityWith } from "./encoding.js";
import { IrisDuplicateName, IrisInvalidName } from "./error.js";
import { registerObserverCallback } from "./observer.js";
import { defineComponent } from "./registry.js";
import { Type } from "./schema.js";
import type { World } from "./world.js";

// ============================================================================
// Component Definitions
// ============================================================================

/**
 * Name component: a unique, non-empty string identifying an entity.
 *
 * Uniqueness and non-emptiness are enforced however the value is written --
 * through {@link setName} or by adding or setting the component directly --
 * and the index behind `lookupByName` stays in sync automatically.
 *
 * @example
 * ```typescript
 * setName(world, entity, "player-1");
 * const name = getName(world, entity);
 * ```
 */
export const Name = defineComponent("Name", { schema: { value: Type.string() } });

// ============================================================================
// Name State
// ============================================================================

/**
 * Name indices kept in sync with entity lifecycle by the name system.
 * @internal
 */
export type NameState = {
  /** Name lookup (name -> entity ID). */
  byName: Map<string, EntityId>;
  /** Reverse name lookup (entity ID -> name). */
  byEntity: Map<EntityId, string>;
};

/**
 * Creates empty name indices.
 * @internal
 */
export function createNameState(): NameState {
  return {
    byName: new Map(),
    byEntity: new Map(),
  };
}

/**
 * Clears the world's name indices.
 * @internal
 */
export function resetNameState(world: World): void {
  world.names.byName.clear();
  world.names.byEntity.clear();
}

// ============================================================================
// Initialization
// ============================================================================

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

    const { byName, byEntity } = world.names;
    const name = byEntity.get(entityId)!;

    byName.delete(name);
    byEntity.delete(entityId);
  });

  // Sync indices when Name component is added or its value changes.
  // Validates uniqueness and non-empty constraints before updating mappings.
  registerObserverCallback(world, "componentChanged", (componentId, entityId) => {
    if (componentId !== Name) {
      return;
    }

    const { byName: nameToEntity, byEntity: entityToName } = world.names;
    const previous = entityToName.get(entityId);
    const current = getComponentValue(world, entityId, Name, "value");

    if (previous === current) {
      return;
    }

    if (!current) {
      throw new IrisInvalidName();
    }

    if (nameToEntity.has(current)) {
      throw new IrisDuplicateName(current);
    }

    // Remove old mapping if renaming an entity
    if (previous !== undefined) {
      nameToEntity.delete(previous);
    }

    nameToEntity.set(current, entityId);
    entityToName.set(entityId, current);
  });

  // Clean up indices when a named entity is destroyed
  registerObserverCallback(world, "entityDestroyed", (entityId) => {
    const { byName, byEntity } = world.names;
    const name = byEntity.get(entityId);

    if (name === undefined) {
      return;
    }

    byName.delete(name);
    byEntity.delete(entityId);
  });
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Gets the name of an entity.
 *
 * Returns undefined when the entity is unnamed; assign names with
 * {@link setName}.
 *
 * @throws {IrisEntityNotFound} If the entity is not alive
 *
 * @example
 * ```typescript
 * const name = getName(world, entity);
 * ```
 */
export function getName(world: World, entityId: EntityId): string | undefined {
  return getComponentValue(world, entityId, Name, "value");
}

/**
 * Sets or updates the name of an entity.
 *
 * No-op when the entity already has this exact name. Renaming frees the old
 * name for reuse. Find named entities with {@link lookupByName}.
 *
 * @throws {IrisEntityNotFound} If the entity is not alive
 * @throws {IrisInvalidName} If the name is empty
 * @throws {IrisDuplicateName} If another entity already holds the name
 *
 * @example
 * ```typescript
 * setName(world, player, "player-1");
 * ```
 */
export function setName(world: World, entityId: EntityId, name: string): void {
  if (!name) {
    throw new IrisInvalidName();
  }

  if (getName(world, entityId) === name) {
    return;
  }

  if (lookupByName(world, name) !== undefined) {
    throw new IrisDuplicateName(name);
  }

  if (!hasComponent(world, entityId, Name)) {
    addComponent(world, entityId, [Name, { value: name }]);
    return;
  }

  setComponentValue(world, entityId, Name, "value", name);
}

/**
 * Removes the name from an entity, freeing it for reuse.
 *
 * Idempotent: removing from an unnamed entity does nothing.
 *
 * @throws {IrisEntityNotFound} If the entity is not alive
 *
 * @example
 * ```typescript
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
 * Looks up an entity by name, optionally requiring components.
 *
 * Returns undefined when no entity holds the name or when the named entity
 * lacks any of the required components. A successful lookup with components
 * narrows the result, making typed accessors like {@link getComponentValue}
 * return non-optional values.
 *
 * @example
 * ```typescript
 * const player = lookupByName(world, "player-1");
 * const armed = lookupByName(world, "player-1", [Position, Health]);
 * ```
 */
export function lookupByName<C extends EntityId[]>(
  world: World,
  name: string,
  components?: C
): EntityWith<C[number]> | undefined {
  const entityId = world.names.byName.get(name);

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
