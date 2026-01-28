import assert from "node:assert";
import { describe, it } from "node:test";
import { hasComponent } from "./component.js";
import { fetchEntities } from "./query.js";
import { defineComponent } from "./registry.js";
import { addResource, getResourceValue, hasResource, removeResource, setResourceValue } from "./resource.js";
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
      const Config = defineComponent("Config", { debug: Type.bool() });

      addResource(world, Config, { debug: false });
      assert.strictEqual(getResourceValue(world, Config, "debug"), false);

      setResourceValue(world, Config, "debug", true);
      assert.strictEqual(getResourceValue(world, Config, "debug"), true);
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

      const results = [...fetchEntities(world, Physics)];

      // Should find the singleton entity (which is the component ID itself)
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0], Physics);
    });
  });
});
