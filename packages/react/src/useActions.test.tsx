import assert from "node:assert";
import { describe, it } from "node:test";
import { act, renderHook } from "@testing-library/react";
import type { World } from "iris-ecs";
import {
  addComponent,
  createEntity,
  createWorld,
  defineActions,
  defineComponent,
  hasComponent,
  resetWorld,
  Type,
} from "iris-ecs";
import { WorldProvider } from "./context.js";
import { useActions } from "./useActions.js";

// ============================================================================
// Test Components
// ============================================================================

const Position = defineComponent("Position", {
  schema: {
    x: Type.f32(),
    y: Type.f32(),
  },
});

// ============================================================================
// Test Actions
// ============================================================================

const spawnActions = defineActions((world) => ({
  spawn(x: number, y: number) {
    const e = createEntity(world);
    addComponent(world, e, Position, { x, y });
    return e;
  },
}));

const counterActions = defineActions((world) => {
  let count = 0;

  return {
    increment() {
      count++;
      void world;
    },
    getCount() {
      return count;
    },
  };
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
// useActions
// ============================================================================

describe("useActions", () => {
  it("returns actions object", () => {
    const world = createWorld();
    const { result } = renderHook(() => useActions(spawnActions), { wrapper: createWrapper(world) });

    assert.strictEqual(typeof result.current.spawn, "function");
  });

  it("returns same reference across re-renders", () => {
    const world = createWorld();
    const { result, rerender } = renderHook(() => useActions(spawnActions), { wrapper: createWrapper(world) });

    const first = result.current;
    rerender();
    const second = result.current;

    assert.strictEqual(first, second);
  });

  it("actions are functional", () => {
    const world = createWorld();
    const { result } = renderHook(() => useActions(spawnActions), { wrapper: createWrapper(world) });

    const entity = result.current.spawn(10, 20);

    assert.strictEqual(hasComponent(world, entity, Position), true);
  });

  it("different action getters return different objects", () => {
    const world = createWorld();
    const { result: spawnResult } = renderHook(() => useActions(spawnActions), { wrapper: createWrapper(world) });
    const { result: counterResult } = renderHook(() => useActions(counterActions), { wrapper: createWrapper(world) });

    assert.notStrictEqual(spawnResult.current, counterResult.current);
  });
});

// ============================================================================
// useActions — World Reset
// ============================================================================

describe("useActions world reset", () => {
  it("returns fresh actions after resetWorld", () => {
    const world = createWorld();
    const { result } = renderHook(() => useActions(spawnActions), { wrapper: createWrapper(world) });

    const before = result.current;

    act(() => {
      resetWorld(world);
    });

    // Actions object is re-created because resetWorld clears world.actions.byInitializer
    assert.notStrictEqual(result.current, before);
  });

  it("resets closure state in actions after resetWorld", () => {
    const world = createWorld();

    // counterActions must be per-test to avoid shared closure state across tests
    const testCounterActions = defineActions((w) => {
      let count = 0;
      return {
        increment() {
          count++;
          void w;
        },
        getCount() {
          return count;
        },
      };
    });

    const { result } = renderHook(() => useActions(testCounterActions), { wrapper: createWrapper(world) });

    result.current.increment();
    result.current.increment();

    assert.strictEqual(result.current.getCount(), 2);

    act(() => {
      resetWorld(world);
    });

    // Closure state is fresh, count starts at 0 again
    assert.strictEqual(result.current.getCount(), 0);
  });

  it("actions remain functional after resetWorld", () => {
    const world = createWorld();
    const { result } = renderHook(() => useActions(spawnActions), { wrapper: createWrapper(world) });

    act(() => {
      resetWorld(world);
    });

    // Spawning on the reset world should work
    const entity = result.current.spawn(5, 10);
    assert.strictEqual(hasComponent(world, entity, Position), true);
  });
});
