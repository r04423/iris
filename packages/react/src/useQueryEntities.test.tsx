import assert from "node:assert";
import { describe, it } from "node:test";
import { act, renderHook } from "@testing-library/react";
import type { World } from "iris-ecs";
import {
  addComponent,
  createEntity,
  createWorld,
  defineComponent,
  defineRelation,
  defineTag,
  destroyEntity,
  isEntityAlive,
  not,
  pair,
  removeComponent,
  resetWorld,
  setComponentValue,
  Type,
} from "iris-ecs";
import { WorldProvider } from "./context.js";
import { useQueryEntities } from "./useQueryEntities.js";

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

const Dead = defineTag("Dead");

// ============================================================================
// Helpers
// ============================================================================

function createWrapper(world: World) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <WorldProvider world={world}>{children}</WorldProvider>;
  };
}

// ============================================================================
// useQueryEntities
// ============================================================================

describe("useQueryEntities", () => {
  it("returns empty array when no entities match", () => {
    const world = createWorld();

    const { result } = renderHook(() => useQueryEntities(Position), {
      wrapper: createWrapper(world),
    });

    assert.deepStrictEqual(result.current, []);
  });

  it("returns matching entities after addComponent", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Position, { x: 0, y: 0 });

    const { result } = renderHook(() => useQueryEntities(Position), {
      wrapper: createWrapper(world),
    });

    assert.deepStrictEqual(result.current, [entity]);
  });

  it("returns matching entities for multi-component query", () => {
    const world = createWorld();
    const both = createEntity(world);
    addComponent(world, both, Position, { x: 0, y: 0 });
    addComponent(world, both, Health, { current: 100, max: 100 });

    const posOnly = createEntity(world);
    addComponent(world, posOnly, Position, { x: 1, y: 1 });

    const { result } = renderHook(() => useQueryEntities(Position, Health), {
      wrapper: createWrapper(world),
    });

    assert.deepStrictEqual(result.current, [both]);
  });

  it("updates when entity gains matching component", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Position, { x: 0, y: 0 });

    const { result } = renderHook(() => useQueryEntities(Position, Health), {
      wrapper: createWrapper(world),
    });

    assert.deepStrictEqual(result.current, []);

    act(() => {
      addComponent(world, entity, Health, { current: 100, max: 100 });
    });

    assert.deepStrictEqual(result.current, [entity]);
  });

  it("removes entities from result after removeComponent", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Position, { x: 0, y: 0 });

    const { result } = renderHook(() => useQueryEntities(Position), {
      wrapper: createWrapper(world),
    });

    assert.deepStrictEqual(result.current, [entity]);

    act(() => {
      removeComponent(world, entity, Position);
    });

    assert.deepStrictEqual(result.current, []);
  });

  it("removes entities from result after destroyEntity", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Position, { x: 0, y: 0 });

    const { result } = renderHook(() => useQueryEntities(Position), {
      wrapper: createWrapper(world),
    });

    assert.deepStrictEqual(result.current, [entity]);

    act(() => {
      destroyEntity(world, entity);
    });

    assert.deepStrictEqual(result.current, []);
  });

  it("not() modifier excludes correctly", () => {
    const world = createWorld();
    const alive = createEntity(world);
    addComponent(world, alive, Position, { x: 0, y: 0 });

    const dead = createEntity(world);
    addComponent(world, dead, Position, { x: 1, y: 1 });
    addComponent(world, dead, Dead);

    const { result } = renderHook(() => useQueryEntities(Position, not(Dead)), {
      wrapper: createWrapper(world),
    });

    assert.deepStrictEqual(result.current, [alive]);

    act(() => {
      addComponent(world, alive, Dead);
    });

    assert.deepStrictEqual(result.current, []);
  });

  it("does not re-render on irrelevant component changes", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Position, { x: 0, y: 0 });

    let renderCount = 0;

    renderHook(
      () => {
        renderCount++;
        return useQueryEntities(Position);
      },
      { wrapper: createWrapper(world) }
    );

    const initialRenderCount = renderCount;

    act(() => {
      addComponent(world, entity, Health, { current: 100, max: 100 });
    });

    assert.strictEqual(renderCount, initialRenderCount);
  });

  it("does not re-render on componentChanged", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Position, { x: 0, y: 0 });

    let renderCount = 0;

    renderHook(
      () => {
        renderCount++;
        return useQueryEntities(Position);
      },
      { wrapper: createWrapper(world) }
    );

    const initialRenderCount = renderCount;

    act(() => {
      setComponentValue(world, entity, Position, "x", 99);
    });

    assert.strictEqual(renderCount, initialRenderCount);
  });

  it("array reference is stable when contents have not changed", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Position, { x: 0, y: 0 });

    const unrelated = createEntity(world);

    const { result } = renderHook(() => useQueryEntities(Position), {
      wrapper: createWrapper(world),
    });

    const firstRef = result.current;

    act(() => {
      destroyEntity(world, unrelated);
    });

    assert.strictEqual(result.current, firstRef);
  });

  it("array reference changes when contents change", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Position, { x: 0, y: 0 });

    const { result } = renderHook(() => useQueryEntities(Position), {
      wrapper: createWrapper(world),
    });

    const firstRef = result.current;

    act(() => {
      removeComponent(world, entity, Position);
    });

    assert.notStrictEqual(result.current, firstRef);
  });

  it("queries by pair term and updates when target is destroyed", () => {
    const world = createWorld();
    const ChildOf = defineRelation("ChildOf");

    const parent = createEntity(world);
    const child1 = createEntity(world);
    const child2 = createEntity(world);
    const unrelated = createEntity(world);
    addComponent(world, child1, pair(ChildOf, parent));
    addComponent(world, child2, pair(ChildOf, parent));
    addComponent(world, unrelated, pair(ChildOf, unrelated));

    const pairTerm = pair(ChildOf, parent);

    const { result } = renderHook(() => useQueryEntities(pairTerm), {
      wrapper: createWrapper(world),
    });

    assert.strictEqual(result.current.length, 2);
    assert.ok((result.current as number[]).includes(child1 as number));
    assert.ok((result.current as number[]).includes(child2 as number));

    // Removing the pair from one child updates the result
    act(() => {
      removeComponent(world, child1, pairTerm);
    });

    assert.deepStrictEqual(result.current, [child2]);

    // Destroying the target removes the pair from remaining children
    act(() => {
      destroyEntity(world, parent);
    });

    assert.deepStrictEqual(result.current, []);
  });

  it("removes cascaded children when relation target is destroyed", () => {
    const world = createWorld();
    const CascadeChildOf = defineRelation("CascadeChildOf", { onDeleteTarget: "delete" });

    const parent = createEntity(world);
    const child = createEntity(world);
    addComponent(world, child, Position, { x: 0, y: 0 });
    addComponent(world, child, pair(CascadeChildOf, parent));

    const { result } = renderHook(() => useQueryEntities(Position), {
      wrapper: createWrapper(world),
    });

    assert.deepStrictEqual(result.current, [child]);

    act(() => {
      destroyEntity(world, parent);
    });

    assert.strictEqual(isEntityAlive(world, child), false);
    assert.deepStrictEqual(result.current, []);
  });

  it("returns empty array after resetWorld", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Position, { x: 0, y: 0 });

    const { result } = renderHook(() => useQueryEntities(Position), {
      wrapper: createWrapper(world),
    });

    assert.deepStrictEqual(result.current, [entity]);

    act(() => {
      resetWorld(world);
    });

    assert.deepStrictEqual(result.current, []);
  });

  it("re-populates after resetWorld and new entity creation", () => {
    const world = createWorld();
    const entity = createEntity(world);
    addComponent(world, entity, Position, { x: 0, y: 0 });

    const { result } = renderHook(() => useQueryEntities(Position), {
      wrapper: createWrapper(world),
    });

    assert.strictEqual(result.current.length, 1);

    act(() => {
      resetWorld(world);
    });

    assert.deepStrictEqual(result.current, []);

    act(() => {
      const newEntity = createEntity(world);
      addComponent(world, newEntity, Position, { x: 5, y: 5 });
    });

    assert.strictEqual(result.current.length, 1);
  });
});
