import assert from "node:assert";
import { describe, it } from "node:test";
import { act, renderHook } from "@testing-library/react";
import type { EntityId, World } from "iris-ecs";
import {
  addComponent,
  createEntity,
  createWorld,
  defineComponent,
  removeComponent,
  setComponentValue,
  Type,
} from "iris-ecs";
import { WorldProvider } from "./context.js";
import { useHasComponent } from "./useHasComponent.js";

// ============================================================================
// Test Components
// ============================================================================

const Health = defineComponent("Health", {
  schema: {
    current: Type.f32(),
    max: Type.f32(),
  },
});

const Position = defineComponent("Position", {
  schema: {
    x: Type.f32(),
    y: Type.f32(),
  },
});

// ============================================================================
// Helpers
// ============================================================================

function createWrapper(world: World) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <WorldProvider world={world}>{children}</WorldProvider>;
  };
}

// ============================================================================
// useHasComponent
// ============================================================================

describe("useHasComponent", () => {
  it("returns true when entity has the component", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Health, { current: 100, max: 100 });

    const { result } = renderHook(() => useHasComponent(entity, Health), {
      wrapper: createWrapper(world),
    });

    assert.strictEqual(result.current, true);
  });

  it("returns false when entity lacks the component", () => {
    const world = createWorld();
    const entity = createEntity(world);

    const { result } = renderHook(() => useHasComponent(entity, Health), {
      wrapper: createWrapper(world),
    });

    assert.strictEqual(result.current, false);
  });

  it("tracks an optional entity", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Health, { current: 100, max: 100 });

    const { result, rerender } = renderHook(
      ({ entityId }: { entityId: EntityId | undefined }) => useHasComponent(entityId, Health),
      {
        wrapper: createWrapper(world),
        initialProps: { entityId: undefined as EntityId | undefined },
      }
    );

    assert.strictEqual(result.current, false);

    rerender({ entityId: entity });

    assert.strictEqual(result.current, true);

    rerender({ entityId: undefined });

    assert.strictEqual(result.current, false);
  });

  it("updates to true on addComponent", () => {
    const world = createWorld();
    const entity = createEntity(world);

    const { result } = renderHook(() => useHasComponent(entity, Health), {
      wrapper: createWrapper(world),
    });

    assert.strictEqual(result.current, false);

    act(() => {
      addComponent(world, entity, Health, { current: 100, max: 100 });
    });

    assert.strictEqual(result.current, true);
  });

  it("updates to false on removeComponent", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Health, { current: 100, max: 100 });

    const { result } = renderHook(() => useHasComponent(entity, Health), {
      wrapper: createWrapper(world),
    });

    assert.strictEqual(result.current, true);

    act(() => {
      removeComponent(world, entity, Health);
    });

    assert.strictEqual(result.current, false);
  });

  it("does not re-render on componentChanged", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Health, { current: 100, max: 100 });

    let renderCount = 0;

    renderHook(
      () => {
        renderCount++;
        return useHasComponent(entity, Health);
      },
      { wrapper: createWrapper(world) }
    );

    const initialRenderCount = renderCount;

    act(() => {
      setComponentValue(world, entity, Health, "current", 50);
    });

    assert.strictEqual(renderCount, initialRenderCount);
  });

  it("does not re-render when a different entity's component changes", () => {
    const world = createWorld();
    const entity1 = createEntity(world);
    const entity2 = createEntity(world);

    let renderCount = 0;

    renderHook(
      () => {
        renderCount++;
        return useHasComponent(entity1, Health);
      },
      { wrapper: createWrapper(world) }
    );

    const initialRenderCount = renderCount;

    act(() => {
      addComponent(world, entity2, Health, { current: 100, max: 100 });
    });

    assert.strictEqual(renderCount, initialRenderCount);
  });

  it("does not re-render when a different component is added to the same entity", () => {
    const world = createWorld();
    const entity = createEntity(world);

    let renderCount = 0;

    renderHook(
      () => {
        renderCount++;
        return useHasComponent(entity, Health);
      },
      { wrapper: createWrapper(world) }
    );

    const initialRenderCount = renderCount;

    act(() => {
      addComponent(world, entity, Position, { x: 0, y: 0 });
    });

    assert.strictEqual(renderCount, initialRenderCount);
  });
});
