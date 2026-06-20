import assert from "node:assert";
import { describe, it } from "node:test";
import { hasComponent } from "./component.js";
import { collectEntities } from "./query.js";
import { defineComponent } from "./registry.js";
import {
  addResource,
  getResourceValue,
  getResourceVectorValue,
  getResourceVectorView,
  hasResource,
  removeResource,
  setResourceValue,
  setResourceVectorValue,
} from "./resource.js";
import { Type } from "./schema.js";
import { createWorld } from "./world.js";

describe("Resource", () => {
  describe("Global Resources", () => {
    it("adds and accesses global resource", () => {
      const world = createWorld();
      const Time = defineComponent("Time", { delta: Type.f64(), elapsed: Type.f64() });

      addResource(world, Time, { delta: 0.016, elapsed: 100.0 });

      assert.strictEqual(hasResource(world, Time), true);
      assert.strictEqual(getResourceValue(world, Time, "delta"), 0.016);
      assert.strictEqual(getResourceValue(world, Time, "elapsed"), 100.0);
    });

    it("modifies global resource", () => {
      const world = createWorld();
      const Config = defineComponent("Config", { mode: Type.string<"debug" | "release">() });

      addResource(world, Config, { mode: "debug" });
      assert.strictEqual(getResourceValue(world, Config, "mode"), "debug");

      setResourceValue(world, Config, "mode", "release");
      const mode: "debug" | "release" | undefined = getResourceValue(world, Config, "mode");
      assert.strictEqual(mode, "release");
    });

    it("removes global resource", () => {
      const world = createWorld();
      const Time = defineComponent("Time", { delta: Type.f32() });

      addResource(world, Time, { delta: 0.016 });
      assert.strictEqual(hasResource(world, Time), true);

      removeResource(world, Time);
      assert.strictEqual(hasResource(world, Time), false);
      assert.strictEqual(getResourceValue(world, Time, "delta"), undefined);
    });

    it("uses Component-on-Self pattern", () => {
      const world = createWorld();
      const Global = defineComponent("Global", { value: Type.i32() });

      addResource(world, Global, { value: 123 });

      // Check via standard component API
      // The component ID is used as both the Entity ID and the Component ID
      assert.strictEqual(hasComponent(world, Global, Global), true);
    });

    it("appears in standard queries", () => {
      const world = createWorld();
      const Physics = defineComponent("Physics", { gravity: Type.f32() });

      addResource(world, Physics, { gravity: 9.81 });

      const results = collectEntities(world, [Physics]);

      // Should find the singleton entity (which is the component ID itself)
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0], Physics);
    });
  });

  describe("Vector Resources", () => {
    it("adds and reads vector resource", () => {
      const world = createWorld();
      const Gravity = defineComponent("Gravity", { value: Type.f64(3) });

      addResource(world, Gravity, { value: [0, -9.81, 0] });

      const value = getResourceVectorValue(world, Gravity, "value");
      assert.deepStrictEqual(value, [0, -9.81, 0]);
    });

    it("writes vector resource", () => {
      const world = createWorld();
      const Gravity = defineComponent("Gravity", { value: Type.f64(3) });

      addResource(world, Gravity, { value: [0, -9.81, 0] });
      setResourceVectorValue(world, Gravity, "value", [0, -20, 0]);

      const value = getResourceVectorValue(world, Gravity, "value");
      assert.deepStrictEqual(value, [0, -20, 0]);
    });

    it("returns zero-copy typed array view", () => {
      const world = createWorld();
      const Gravity = defineComponent("Gravity", { value: Type.f64(3) });

      addResource(world, Gravity, { value: [0, -9.81, 0] });

      const view = getResourceVectorView(world, Gravity, "value");
      assert.ok(view instanceof Float64Array);
      assert.strictEqual(view!.length, 3);

      // Mutate through view
      view![1] = -20;

      // Change visible via copy read
      const value = getResourceVectorValue(world, Gravity, "value");
      assert.deepStrictEqual(value, [0, -20, 0]);
    });

    it("returns undefined for missing resource", () => {
      const world = createWorld();
      const Gravity = defineComponent("Gravity", { value: Type.f64(3) });

      assert.strictEqual(getResourceVectorValue(world, Gravity, "value"), undefined);
      assert.strictEqual(getResourceVectorView(world, Gravity, "value"), undefined);
    });
  });
});
