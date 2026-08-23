import assert from "node:assert";
import { describe, it } from "node:test";
import { act, renderHook } from "@testing-library/react";
import type { EntityWith, World } from "iris-ecs";
import {
  addComponent,
  createEntity,
  createWorld,
  defineComponent,
  destroyEntity,
  removeComponent,
  removeName,
  resetWorld,
  setName,
  Type,
} from "iris-ecs";
import { WorldProvider } from "./context.js";
import { useEntityByName } from "./useEntityByName.js";

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
// Helpers
// ============================================================================

function createWrapper(world: World) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <WorldProvider world={world}>{children}</WorldProvider>;
  };
}

// ============================================================================
// useEntityByName
// ============================================================================

describe("useEntityByName", () => {
  it("returns the named entity", () => {
    const world = createWorld();
    const entity = createEntity(world);
    setName(world, entity, "player");

    const { result } = renderHook(() => useEntityByName("player"), {
      wrapper: createWrapper(world),
    });

    assert.strictEqual(result.current, entity);
  });

  it("updates when an entity receives the requested name", () => {
    const world = createWorld();
    const entity = createEntity(world);

    const { result } = renderHook(() => useEntityByName("player"), {
      wrapper: createWrapper(world),
    });

    assert.strictEqual(result.current, undefined);

    act(() => {
      setName(world, entity, "player");
    });

    assert.strictEqual(result.current, entity);
  });

  it("updates when an entity is renamed to or away from the requested name", () => {
    const world = createWorld();
    const entity = createEntity(world);
    setName(world, entity, "enemy");

    const { result } = renderHook(() => useEntityByName("player"), {
      wrapper: createWrapper(world),
    });

    act(() => {
      setName(world, entity, "player");
    });

    assert.strictEqual(result.current, entity);

    act(() => {
      setName(world, entity, "hero");
    });

    assert.strictEqual(result.current, undefined);
  });

  it("validates required components reactively", () => {
    const world = createWorld();
    const entity = createEntity(world);
    setName(world, entity, "player");

    const { result } = renderHook(() => useEntityByName("player", [Position]), {
      wrapper: createWrapper(world),
    });
    const typed: EntityWith<typeof Position> | undefined = result.current;

    assert.strictEqual(typed, undefined);

    act(() => {
      addComponent(world, entity, [Position, { x: 0, y: 0 }]);
    });

    assert.strictEqual(result.current, entity);

    act(() => {
      removeComponent(world, entity, Position);
    });

    assert.strictEqual(result.current, undefined);
  });

  it("updates when the name is removed", () => {
    const world = createWorld();
    const entity = createEntity(world);
    setName(world, entity, "player");

    const { result } = renderHook(() => useEntityByName("player"), {
      wrapper: createWrapper(world),
    });

    act(() => {
      removeName(world, entity);
    });

    assert.strictEqual(result.current, undefined);
  });

  it("updates when the named entity is destroyed", () => {
    const world = createWorld();
    const entity = createEntity(world);
    setName(world, entity, "player");

    const { result } = renderHook(() => useEntityByName("player"), {
      wrapper: createWrapper(world),
    });

    act(() => {
      destroyEntity(world, entity);
    });

    assert.strictEqual(result.current, undefined);
  });

  it("returns undefined after resetWorld", () => {
    const world = createWorld();
    const entity = createEntity(world);
    setName(world, entity, "player");

    const { result } = renderHook(() => useEntityByName("player"), {
      wrapper: createWrapper(world),
    });

    act(() => {
      resetWorld(world);
    });

    assert.strictEqual(result.current, undefined);
  });
});
