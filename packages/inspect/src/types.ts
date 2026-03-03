import type { EntityId } from "iris-ecs";

// ============================================================================
// Entity Snapshot
// ============================================================================

/**
 * Snapshot of an entity's state for display in DevTools.
 */
export type EntitySnapshot = {
  /** Encoded entity ID (branded number). */
  id: EntityId;
  /** Entity name from the Name component, or undefined if unnamed. */
  name: string | undefined;
  /** Number of components on this entity. */
  componentCount: number;
};

// ============================================================================
// Panel
// ============================================================================

/**
 * Panel identifiers for the DevTools UI.
 */
export type PanelId = "entities";

// ============================================================================
// Store
// ============================================================================

/**
 * DevTools state shape.
 */
export type DevToolsState = {
  // Entity data (written by bridge)
  entities: Map<EntityId, EntitySnapshot>;
  entityCount: number;

  // UI state
  expanded: boolean;
  activePanel: PanelId;
  searchQuery: string;

  // UI actions
  setExpanded: (expanded: boolean) => void;
  setSearchQuery: (query: string) => void;
  setActivePanel: (panel: PanelId) => void;

  // Bridge actions (internal)
  _addEntity: (snapshot: EntitySnapshot) => void;
  _removeEntity: (id: EntityId) => void;
  _updateEntityName: (id: EntityId, name: string | undefined) => void;
  _updateEntityComponentCount: (id: EntityId, count: number) => void;
  _reset: () => void;
  _loadSnapshot: (entities: Map<EntityId, EntitySnapshot>) => void;
};
