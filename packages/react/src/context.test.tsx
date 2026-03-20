import assert from "node:assert";
import { describe, it } from "node:test";
import { act, renderHook } from "@testing-library/react";
import type { World } from "iris-ecs";
import { createWorld, resetWorld } from "iris-ecs";
import { useResetGeneration, useWorld, WorldProvider } from "./context.js";

// ============================================================================
// Helpers
// ============================================================================

function createWrapper(world: World) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <WorldProvider world={world}>{children}</WorldProvider>;
  };
}

// ============================================================================
// useWorld
// ============================================================================

describe("useWorld", () => {
  it("throws when used outside WorldProvider", () => {
    assert.throws(
      () => renderHook(() => useWorld()),
      (error: Error) => error.message === "useWorld must be used within a WorldProvider"
    );
  });

  it("returns the provided world instance", () => {
    const world = createWorld();
    const { result } = renderHook(() => useWorld(), { wrapper: createWrapper(world) });

    assert.strictEqual(result.current, world);
  });

  it("updates when world reference changes", () => {
    const world1 = createWorld();
    const world2 = createWorld();

    let activeWorld = world1;

    function Wrapper({ children }: { children: React.ReactNode }) {
      return <WorldProvider world={activeWorld}>{children}</WorldProvider>;
    }

    const { result, rerender } = renderHook(() => useWorld(), { wrapper: Wrapper });

    assert.strictEqual(result.current, world1);

    activeWorld = world2;
    rerender();

    assert.strictEqual(result.current, world2);
  });
});

// ============================================================================
// WorldProvider Reset Generation
// ============================================================================

describe("WorldProvider reset generation", () => {
  it("increments generation on worldReset", () => {
    const world = createWorld();
    const { result } = renderHook(() => useResetGeneration(), { wrapper: createWrapper(world) });

    assert.strictEqual(result.current, 0);

    act(() => {
      resetWorld(world);
    });

    assert.strictEqual(result.current, 1);
  });

  it("increments generation on each reset", () => {
    const world = createWorld();
    const { result } = renderHook(() => useResetGeneration(), { wrapper: createWrapper(world) });

    act(() => {
      resetWorld(world);
    });
    act(() => {
      resetWorld(world);
    });

    assert.strictEqual(result.current, 2);
  });

  it("unregisters worldReset observer on unmount", () => {
    const world = createWorld();
    const baselineCount = world.observers.worldReset.callbacks.length;

    const { unmount } = renderHook(() => useResetGeneration(), { wrapper: createWrapper(world) });

    assert.strictEqual(world.observers.worldReset.callbacks.length, baselineCount + 1);

    unmount();

    assert.strictEqual(world.observers.worldReset.callbacks.length, baselineCount);
  });

  it("re-registers observer when world prop changes", () => {
    const world1 = createWorld();
    const world2 = createWorld();

    let activeWorld = world1;

    function Wrapper({ children }: { children: React.ReactNode }) {
      return <WorldProvider world={activeWorld}>{children}</WorldProvider>;
    }

    const { result, rerender } = renderHook(() => useResetGeneration(), { wrapper: Wrapper });

    assert.strictEqual(result.current, 0);

    // Switch to world2
    activeWorld = world2;
    rerender();

    // Resetting world1 should NOT increment generation (observer was removed)
    act(() => {
      resetWorld(world1);
    });
    assert.strictEqual(result.current, 0);

    // Resetting world2 should increment generation
    act(() => {
      resetWorld(world2);
    });
    assert.strictEqual(result.current, 1);
  });
});
