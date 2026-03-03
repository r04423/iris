import type { EntityId } from "iris-ecs";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { DevToolsState, EntitySnapshot } from "./types.js";

// ============================================================================
// Store Factory
// ============================================================================

/**
 * Zustand store holding DevTools state.
 */
export type DevToolsStore = StoreApi<DevToolsState>;

/**
 * Creates a Zustand vanilla store for DevTools state.
 *
 * Uses zustand/vanilla so bridge.ts can write outside React context.
 * React components read via useStore(store, selector).
 *
 * @internal
 */
export function createDevToolsStore() {
  return createStore<DevToolsState>((set) => ({
    // Entity data
    entities: new Map(),
    entityCount: 0,

    // UI state
    expanded: false,
    activePanel: "entities",
    searchQuery: "",

    // UI actions
    setExpanded: (expanded) => set({ expanded }),
    setSearchQuery: (searchQuery) => set({ searchQuery }),
    setActivePanel: (activePanel) => set({ activePanel }),

    // Bridge actions
    _addEntity: (snapshot: EntitySnapshot) =>
      set((state) => {
        const entities = new Map(state.entities);
        entities.set(snapshot.id, snapshot);
        return { entities, entityCount: entities.size };
      }),

    _removeEntity: (id: EntityId) =>
      set((state) => {
        const entities = new Map(state.entities);
        entities.delete(id);
        return { entities, entityCount: entities.size };
      }),

    _updateEntityName: (id: EntityId, name: string | undefined) =>
      set((state) => {
        const existing = state.entities.get(id);
        if (!existing) return state;
        const entities = new Map(state.entities);
        entities.set(id, { ...existing, name });
        return { entities };
      }),

    _updateEntityComponentCount: (id: EntityId, count: number) =>
      set((state) => {
        const existing = state.entities.get(id);
        if (!existing) return state;
        const entities = new Map(state.entities);
        entities.set(id, { ...existing, componentCount: count });
        return { entities };
      }),

    _reset: () => set({ entities: new Map(), entityCount: 0 }),

    _loadSnapshot: (entities: Map<EntityId, EntitySnapshot>) => set({ entities, entityCount: entities.size }),
  }));
}
