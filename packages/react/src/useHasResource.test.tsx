import assert from "node:assert";
import { describe, it } from "node:test";
import { act, renderHook } from "@testing-library/react";
import type { World } from "iris-ecs";
import { addResource, createWorld, defineComponent, removeResource, Type } from "iris-ecs";
import { WorldProvider } from "./context.js";
import { useHasResource } from "./useHasResource.js";

// ============================================================================
// Test Resources
// ============================================================================

const Time = defineComponent("Time", {
  schema: {
    delta: Type.f32(),
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
// useHasResource
// ============================================================================

describe("useHasResource", () => {
  it("returns whether the resource exists", () => {
    const world = createWorld();
    addResource(world, Time, { delta: 0.016 });

    const { result } = renderHook(() => useHasResource(Time), {
      wrapper: createWrapper(world),
    });

    assert.strictEqual(result.current, true);
  });

  it("updates when the resource is added", () => {
    const world = createWorld();
    const { result } = renderHook(() => useHasResource(Time), {
      wrapper: createWrapper(world),
    });

    assert.strictEqual(result.current, false);

    act(() => {
      addResource(world, Time, { delta: 0.016 });
    });

    assert.strictEqual(result.current, true);
  });

  it("updates when the resource is removed", () => {
    const world = createWorld();
    addResource(world, Time, { delta: 0.016 });

    const { result } = renderHook(() => useHasResource(Time), {
      wrapper: createWrapper(world),
    });

    act(() => {
      removeResource(world, Time);
    });

    assert.strictEqual(result.current, false);
  });
});
