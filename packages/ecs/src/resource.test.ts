import assert from "node:assert";
import { describe, it } from "node:test";
import { createEntity } from "./entity.js";
import { changed, collectEntities, queryEntities } from "./query.js";
import { defineComponent } from "./registry.js";
import {
  addResource,
  getResource,
  getResourceValue,
  getResourceView,
  hasResource,
  markResourceChanged,
  removeResource,
  setResource,
  setResourceValue,
} from "./resource.js";
import { addSystem, defineSystem, runOnce } from "./scheduler.js";
import { Type } from "./schema.js";
import { createWorld } from "./world.js";

describe("Resource", () => {
  describe("Global Resources", () => {
    it("adds and accesses global resource", () => {
      const world = createWorld();
      const Time = defineComponent("Time", { schema: { delta: Type.f64(), elapsed: Type.f64() } });

      addResource(world, Time, { delta: 0.016, elapsed: 100.0 });

      assert.strictEqual(hasResource(world, Time), true);
      assert.strictEqual(getResourceValue(world, Time, "delta"), 0.016);
      assert.strictEqual(getResourceValue(world, Time, "elapsed"), 100.0);
    });

    it("narrows the resource for typed accessors", () => {
      const world = createWorld();
      const Time = defineComponent("TimeNarrowsResource", { schema: { delta: Type.f64() } });

      addResource(world, Time, { delta: 0.016 });

      const dt: number = getResourceValue(world, Time, "delta");
      assert.strictEqual(dt, 0.016);
    });

    it("accepts only data component definitions", () => {
      const world = createWorld();
      const Marker = defineComponent("MarkerRejectedAsResource");
      const entity = createEntity(world);

      function invalidResourceCalls() {
        // @ts-expect-error -- tags cannot identify data-bearing resources
        hasResource(world, Marker);
        // @ts-expect-error -- arbitrary entities cannot identify resources
        removeResource(world, entity);
      }

      void invalidResourceCalls;
    });

    it("modifies global resource", () => {
      const world = createWorld();
      const Config = defineComponent("Config", { schema: { mode: Type.string<"debug" | "release">() } });

      addResource(world, Config, { mode: "debug" });
      assert.strictEqual(getResourceValue(world, Config, "mode"), "debug");

      setResourceValue(world, Config, "mode", "release");
      const mode: "debug" | "release" | undefined = getResourceValue(world, Config, "mode");
      assert.strictEqual(mode, "release");
    });

    it("removes global resource", () => {
      const world = createWorld();
      const Time = defineComponent("TimeRemovesGlobalResource", { schema: { delta: Type.f32() } });

      addResource(world, Time, { delta: 0.016 });
      assert.strictEqual(hasResource(world, Time), true);

      removeResource(world, Time);
      assert.strictEqual(hasResource(world, Time), false);
      assert.strictEqual(getResourceValue(world, Time, "delta"), undefined);
    });

    it("returns an independent record and vector snapshot", () => {
      const world = createWorld();
      const State = defineComponent("StateReturnsIndependentSnapshot", {
        schema: {
          position: Type.f32(2),
          active: Type.bool(),
          cache: Type.ref<Map<string, number>>(),
        },
      });
      const cache = new Map([["score", 1]]);

      addResource(world, State, { position: [10, 20], active: true, cache });

      const snapshot = getResource(world, State);
      const next = getResource(world, State);

      assert.notStrictEqual(snapshot, next);
      assert.notStrictEqual(snapshot.position, next.position);
      assert.strictEqual(snapshot.cache, cache);

      snapshot.position[0] = 99;
      snapshot.active = false;

      assert.deepStrictEqual(getResource(world, State), { position: [10, 20], active: true, cache });
    });

    it("replaces the complete record", () => {
      const world = createWorld();
      const Time = defineComponent("TimeReplacesCompleteRecord", {
        schema: { delta: Type.f64(), elapsed: Type.f64() },
      });

      addResource(world, Time, { delta: 0.016, elapsed: 10 });
      setResource(world, Time, { delta: 0.033, elapsed: 20 });

      assert.deepStrictEqual(getResource(world, Time), { delta: 0.033, elapsed: 20 });
    });

    it("appears in standard queries", () => {
      const world = createWorld();
      const Physics = defineComponent("Physics", { schema: { gravity: Type.f32() } });

      addResource(world, Physics, { gravity: 9.81 });

      const results = collectEntities(world, [Physics]);

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0], Physics);
    });
  });

  describe("Vector Resources", () => {
    it("adds and reads vector resource", () => {
      const world = createWorld();
      const Gravity = defineComponent("Gravity", { schema: { value: Type.f64(3) } });

      addResource(world, Gravity, { value: [0, -9.81, 0] });

      const value = getResourceValue(world, Gravity, "value");
      assert.deepStrictEqual(value, [0, -9.81, 0]);
    });

    it("writes vector resource", () => {
      const world = createWorld();
      const Gravity = defineComponent("GravityWritesVectorResource", { schema: { value: Type.f64(3) } });

      addResource(world, Gravity, { value: [0, -9.81, 0] });
      setResourceValue(world, Gravity, "value", [0, -20, 0]);

      const value = getResourceValue(world, Gravity, "value");
      assert.deepStrictEqual(value, [0, -20, 0]);
    });

    it("returns a live typed array view", () => {
      const world = createWorld();
      const Gravity = defineComponent("GravityReturnsZeroCopyTypedArrayView", { schema: { value: Type.f64(3) } });

      addResource(world, Gravity, { value: [0, -9.81, 0] });

      const view = getResourceView(world, Gravity, "value");
      assert.ok(view instanceof Float64Array);
      assert.strictEqual(view!.length, 3);

      view![1] = -20;

      const value = getResourceValue(world, Gravity, "value");
      assert.deepStrictEqual(value, [0, -20, 0]);
    });

    it("marks view mutations for change detection", async () => {
      const world = createWorld();
      const Gravity = defineComponent("GravityMarksViewMutationChanged", { schema: { value: Type.f64(3) } });
      let changes = 0;

      addResource(world, Gravity, { value: [0, -9.81, 0] });
      addSystem(
        world,
        defineSystem("trackGravityResourceChanges", (world) => {
          queryEntities(world, [changed(Gravity)], () => {
            changes++;
          });
        })
      );

      await runOnce(world);
      await runOnce(world);

      const view = getResourceView(world, Gravity, "value")!;
      view[1] = -20;
      markResourceChanged(world, Gravity);

      await runOnce(world);

      assert.strictEqual(changes, 2);
    });

    it("returns undefined for missing resource", () => {
      const world = createWorld();
      const Gravity = defineComponent("GravityReturnsUndefinedMissingResource", { schema: { value: Type.f64(3) } });

      assert.strictEqual(getResourceValue(world, Gravity, "value"), undefined);
      assert.strictEqual(getResourceView(world, Gravity, "value"), undefined);
    });
  });
});
