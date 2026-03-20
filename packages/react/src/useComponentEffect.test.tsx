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
import { useComponentEffect } from "./useComponentEffect.js";

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

// ============================================================================
// Helpers
// ============================================================================

function createWrapper(world: World) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <WorldProvider world={world}>{children}</WorldProvider>;
  };
}

// ============================================================================
// useComponentEffect
// ============================================================================

describe("useComponentEffect", () => {
  it("calls callback on componentChanged", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Health, { current: 100, max: 100 });

    let callCount = 0;
    renderHook(
      () =>
        useComponentEffect(entity, Health, () => {
          callCount++;
        }),
      {
        wrapper: createWrapper(world),
      }
    );

    act(() => {
      setComponentValue(world, entity, Health, "current", 50);
    });

    assert.strictEqual(callCount, 1);
  });

  it("does not call callback for different entity/component", () => {
    const world = createWorld();
    const entity1 = createEntity(world);
    const entity2 = createEntity(world);
    addComponent(world, entity1, Health, { current: 100, max: 100 });
    addComponent(world, entity2, Health, { current: 100, max: 100 });
    addComponent(world, entity1, Position, { x: 0, y: 0 });

    let callCount = 0;

    renderHook(
      () =>
        useComponentEffect(entity1, Health, () => {
          callCount++;
        }),
      {
        wrapper: createWrapper(world),
      }
    );

    act(() => {
      // Different entity, same component
      setComponentValue(world, entity2, Health, "current", 50);
      // Same entity, different component
      setComponentValue(world, entity1, Position, "x", 99);
    });

    assert.strictEqual(callCount, 0);
  });

  it("calls callback on componentAdded", () => {
    const world = createWorld();
    const entity = createEntity(world);

    let callCount = 0;

    renderHook(
      () =>
        useComponentEffect(entity, Health, () => {
          callCount++;
        }),
      { wrapper: createWrapper(world) }
    );

    assert.strictEqual(callCount, 0);

    // addComponent fires componentAdded once, plus componentChanged per field
    // (2 fields on Health). Total: 3 invocations.
    act(() => {
      addComponent(world, entity, Health, { current: 100, max: 100 });
    });

    assert.ok(callCount >= 1);
  });

  it("calls callback on componentRemoved", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Health, { current: 100, max: 100 });

    let callCount = 0;

    renderHook(
      () =>
        useComponentEffect(entity, Health, () => {
          callCount++;
        }),
      { wrapper: createWrapper(world) }
    );

    act(() => {
      removeComponent(world, entity, Health);
    });

    assert.strictEqual(callCount, 1);
  });

  it("calls cleanup function before next invocation", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Health, { current: 100, max: 100 });

    let cleanupCount = 0;

    renderHook(
      () =>
        useComponentEffect(entity, Health, () => {
          return () => {
            cleanupCount++;
          };
        }),
      { wrapper: createWrapper(world) }
    );

    act(() => {
      setComponentValue(world, entity, Health, "current", 50);
    });

    // First invocation, no cleanup yet
    assert.strictEqual(cleanupCount, 0);

    act(() => {
      setComponentValue(world, entity, Health, "current", 25);
    });

    // Second invocation, previous cleanup runs first
    assert.strictEqual(cleanupCount, 1);
  });

  it("calls cleanup function on unmount", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Health, { current: 100, max: 100 });

    let cleanupCount = 0;

    const { unmount } = renderHook(
      () =>
        useComponentEffect(entity, Health, () => {
          return () => {
            cleanupCount++;
          };
        }),
      { wrapper: createWrapper(world) }
    );

    // Trigger once so cleanup function is set
    act(() => {
      setComponentValue(world, entity, Health, "current", 50);
    });

    assert.strictEqual(cleanupCount, 0);

    unmount();

    assert.strictEqual(cleanupCount, 1);
  });
});
