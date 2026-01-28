import type { EntityId } from "./encoding.js";
import type { Event } from "./event.js";
import { defineEvent, emitEvent } from "./event.js";
import { registerObserverCallback } from "./observer.js";
import { Type } from "./schema.js";
import type { World } from "./world.js";

// ============================================================================
// Removal Event Schema
// ============================================================================

/**
 * Schema for removal events containing the entity that had a component removed.
 */
const RemovalEventSchema = {
  entity: Type.i32(),
};

// ============================================================================
// Global Removal Event Registry
// ============================================================================

/**
 * Maps component IDs to their lazily-created removal events.
 */
const removalEvents = new Map<EntityId, Event<typeof RemovalEventSchema>>();

// ============================================================================
// Public API
// ============================================================================

/**
 * Gets the removal event for a component, creating it lazily if needed.
 * @param componentId - Component to track removals for
 * @returns Event that fires when the component is removed from any entity
 * @example
 * for (const { entity } of fetchEvents(world, removed(Health))) {
 *   playDeathEffect(entity);
 * }
 */
export function removed(componentId: EntityId): Event<typeof RemovalEventSchema> {
  let event = removalEvents.get(componentId);

  if (!event) {
    event = defineEvent(`Removed<${componentId}>`, RemovalEventSchema);
    removalEvents.set(componentId, event);
  }

  return event;
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initializes removal tracking by registering observers for component removals.
 * @param world - World instance to initialize
 * @internal
 */
export function initRemovalSystem(world: World): void {
  // Handle explicit component removal via removeComponent()
  registerObserverCallback(world, "componentRemoved", (componentId, entityId) => {
    emitEvent(world, removed(componentId), { entity: entityId as number });
  });

  // Handle entity destruction - destroyEntity() doesn't call removeComponent() for each
  // component, so we emit removal events for all components on the entity here
  registerObserverCallback(world, "entityDestroyed", (entityId) => {
    // Observer fires before entity metadata is deleted, so meta is guaranteed to exist
    const meta = world.entities.byId.get(entityId)!;

    for (const componentId of meta.archetype.types) {
      // Skip the entity's own ID (entities are components in ECS)
      if (componentId !== entityId) {
        emitEvent(world, removed(componentId), { entity: entityId as number });
      }
    }
  });
}
