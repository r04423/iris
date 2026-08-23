import assert from "node:assert";
import { describe, it } from "node:test";
import { act, renderHook } from "@testing-library/react";
import type { World } from "iris-ecs";
import { addResource, createWorld, defineComponent, setResourceValue, Type } from "iris-ecs";
import { WorldProvider } from "./context.js";
import { useResourceEffect } from "./useResourceEffect.js";

// ============================================================================
// Test Resources
// ============================================================================

const Time = defineComponent("Time", {
  schema: {
    delta: Type.f32(),
  },
});

const Config = defineComponent("Config", {
  schema: {
    volume: Type.f32(),
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
// useResourceEffect
// ============================================================================

describe("useResourceEffect", () => {
  it("calls callback when the resource changes", () => {
    const world = createWorld();
    addResource(world, Time, { delta: 0.016 });

    let callCount = 0;
    renderHook(
      () =>
        useResourceEffect(Time, () => {
          callCount++;
        }),
      { wrapper: createWrapper(world) }
    );

    act(() => {
      setResourceValue(world, Time, "delta", 0.033);
    });

    assert.strictEqual(callCount, 1);
  });

  it("does not call callback when another resource changes", () => {
    const world = createWorld();
    addResource(world, Time, { delta: 0.016 });
    addResource(world, Config, { volume: 1 });

    let callCount = 0;
    renderHook(
      () =>
        useResourceEffect(Time, () => {
          callCount++;
        }),
      { wrapper: createWrapper(world) }
    );

    act(() => {
      setResourceValue(world, Config, "volume", 0.5);
    });

    assert.strictEqual(callCount, 0);
  });
});
