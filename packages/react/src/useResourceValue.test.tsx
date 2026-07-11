import assert from "node:assert";
import { describe, it } from "node:test";
import { act, renderHook } from "@testing-library/react";
import type { World } from "iris-ecs";
import { addResource, createWorld, defineComponent, removeResource, setResourceValue, Type } from "iris-ecs";
import { WorldProvider } from "./context.js";
import { useResourceValue } from "./useResourceValue.js";

// ============================================================================
// Test Resources
// ============================================================================

const Time = defineComponent("Time", {
  delta: Type.f32(),
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
// useResourceValue
// ============================================================================

describe("useResourceValue", () => {
  it("returns the resource field value", () => {
    const world = createWorld();
    addResource(world, Time, { delta: 1 });

    const { result } = renderHook(() => useResourceValue(Time, "delta"), {
      wrapper: createWrapper(world),
    });

    const delta: number | undefined = result.current;
    assert.strictEqual(delta, 1);
  });

  it("updates when the resource field changes", () => {
    const world = createWorld();
    addResource(world, Time, { delta: 1 });

    const { result } = renderHook(() => useResourceValue(Time, "delta"), {
      wrapper: createWrapper(world),
    });

    act(() => {
      setResourceValue(world, Time, "delta", 2);
    });

    assert.strictEqual(result.current, 2);
  });

  it("tracks resource presence", () => {
    const world = createWorld();
    const { result } = renderHook(() => useResourceValue(Time, "delta"), {
      wrapper: createWrapper(world),
    });

    assert.strictEqual(result.current, undefined);

    act(() => {
      addResource(world, Time, { delta: 1 });
    });

    assert.strictEqual(result.current, 1);

    act(() => {
      removeResource(world, Time);
    });

    assert.strictEqual(result.current, undefined);
  });
});
