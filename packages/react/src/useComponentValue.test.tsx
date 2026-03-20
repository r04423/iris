import assert from "node:assert";
import { describe, it } from "node:test";
import { act, renderHook } from "@testing-library/react";
import type { World } from "iris-ecs";
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
import { useComponentValue } from "./useComponentValue.js";

// ============================================================================
// Test Components
// ============================================================================

const Health = defineComponent("Health", {
  current: Type.f32(),
  max: Type.f32(),
});

const Position = defineComponent("Position", {
  x: Type.f32(),
  y: Type.f32(),
});

const Label = defineComponent("Label", {
  name: Type.string(),
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
// useComponentValue
// ============================================================================

describe("useComponentValue", () => {
  it("returns field value for existing component", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Health, { current: 100, max: 100 });

    const { result } = renderHook(() => useComponentValue(entity, Health, "current"), {
      wrapper: createWrapper(world),
    });

    assert.strictEqual(result.current, 100);
  });

  it("returns undefined when entity lacks component", () => {
    const world = createWorld();
    const entity = createEntity(world);

    const { result } = renderHook(() => useComponentValue(entity, Health, "current"), {
      wrapper: createWrapper(world),
    });

    assert.strictEqual(result.current, undefined);
  });

  it("updates on setComponentValue", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Health, { current: 100, max: 100 });

    const { result } = renderHook(() => useComponentValue(entity, Health, "current"), {
      wrapper: createWrapper(world),
    });

    assert.strictEqual(result.current, 100);

    act(() => {
      setComponentValue(world, entity, Health, "current", 50);
    });

    assert.strictEqual(result.current, 50);
  });

  it("transitions to undefined on removeComponent", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Health, { current: 100, max: 100 });

    const { result } = renderHook(() => useComponentValue(entity, Health, "current"), {
      wrapper: createWrapper(world),
    });

    assert.strictEqual(result.current, 100);

    act(() => {
      removeComponent(world, entity, Health);
    });

    assert.strictEqual(result.current, undefined);
  });

  it("updates when component is first added via addComponent", () => {
    const world = createWorld();
    const entity = createEntity(world);

    const { result } = renderHook(() => useComponentValue(entity, Health, "current"), {
      wrapper: createWrapper(world),
    });

    assert.strictEqual(result.current, undefined);

    act(() => {
      addComponent(world, entity, Health, { current: 42, max: 100 });
    });

    assert.strictEqual(result.current, 42);
  });

  it("does not re-render when a different entity's component changes", () => {
    const world = createWorld();
    const entity1 = createEntity(world);
    const entity2 = createEntity(world);
    addComponent(world, entity1, Health, { current: 100, max: 100 });
    addComponent(world, entity2, Health, { current: 100, max: 100 });

    let renderCount = 0;

    renderHook(
      () => {
        renderCount++;
        return useComponentValue(entity1, Health, "current");
      },
      { wrapper: createWrapper(world) }
    );

    const initialRenderCount = renderCount;

    act(() => {
      setComponentValue(world, entity2, Health, "current", 50);
    });

    assert.strictEqual(renderCount, initialRenderCount);
  });

  it("does not re-render when a different component on the same entity changes", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Health, { current: 100, max: 100 });
    addComponent(world, entity, Position, { x: 0, y: 0 });

    let renderCount = 0;

    renderHook(
      () => {
        renderCount++;
        return useComponentValue(entity, Health, "current");
      },
      { wrapper: createWrapper(world) }
    );

    const initialRenderCount = renderCount;

    act(() => {
      setComponentValue(world, entity, Position, "x", 99);
    });

    assert.strictEqual(renderCount, initialRenderCount);
  });

  it("primitive stability: same numeric value does not trigger re-render", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Health, { current: 100, max: 100 });

    let renderCount = 0;

    renderHook(
      () => {
        renderCount++;
        return useComponentValue(entity, Health, "current");
      },
      { wrapper: createWrapper(world) }
    );

    const initialRenderCount = renderCount;

    // Setting the same value fires componentChanged, but Object.is(100, 100)
    // prevents a re-render.
    act(() => {
      setComponentValue(world, entity, Health, "current", 100);
    });

    assert.strictEqual(renderCount, initialRenderCount);
  });

  it("string field stability: same string does not trigger re-render", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Label, { name: "hello" });

    let renderCount = 0;

    renderHook(
      () => {
        renderCount++;
        return useComponentValue(entity, Label, "name");
      },
      { wrapper: createWrapper(world) }
    );

    const initialRenderCount = renderCount;

    act(() => {
      setComponentValue(world, entity, Label, "name", "hello");
    });

    assert.strictEqual(renderCount, initialRenderCount);
  });
});
