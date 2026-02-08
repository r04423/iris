import assert from "node:assert";
import { describe, it } from "node:test";
import { addSystem, buildSchedule, executeSchedule, executeScheduleAsync } from "./scheduler.js";
import { createWorld } from "./world.js";

describe("Scheduler", () => {
  describe("System Registration", () => {
    it("uses function.name as system identifier", () => {
      const world = createWorld();

      function physicsSystem() {}
      addSystem(world, physicsSystem);

      assert.strictEqual(world.systems.byId.has("physicsSystem"), true);
    });

    it("uses options.name over function.name", () => {
      const world = createWorld();

      function physicsSystem() {}
      addSystem(world, physicsSystem, { name: "customName" });

      assert.strictEqual(world.systems.byId.has("customName"), true);
      assert.strictEqual(world.systems.byId.has("physicsSystem"), false);
    });

    it("allows same function registered with different names", () => {
      const world = createWorld();

      function physicsSystem() {}
      addSystem(world, physicsSystem, { name: "physics-objects" });
      addSystem(world, physicsSystem, { name: "physics-particles" });

      assert.strictEqual(world.systems.byId.size, 2);
    });

    it("defaults schedule to 'runtime'", () => {
      const world = createWorld();

      function physicsSystem() {}
      addSystem(world, physicsSystem);

      assert.strictEqual(world.systems.byId.get("physicsSystem")?.schedule, "runtime");
    });

    it("normalizes single constraint string to array", () => {
      const world = createWorld();

      function system() {}
      addSystem(world, system, { before: "other", after: "another" });

      const meta = world.systems.byId.get("system");
      assert.deepStrictEqual(meta?.before, ["other"]);
      assert.deepStrictEqual(meta?.after, ["another"]);
    });

    it("accepts array constraints directly", () => {
      const world = createWorld();

      function system() {}
      addSystem(world, system, { before: ["a", "b"], after: ["c", "d"] });

      const meta = world.systems.byId.get("system");
      assert.deepStrictEqual(meta?.before, ["a", "b"]);
      assert.deepStrictEqual(meta?.after, ["c", "d"]);
    });

    it("assigns sequential registration indices", () => {
      const world = createWorld();

      function first() {}
      function second() {}
      function third() {}

      addSystem(world, first);
      addSystem(world, second);
      addSystem(world, third);

      assert.strictEqual(world.systems.byId.get("first")?.index, 0);
      assert.strictEqual(world.systems.byId.get("second")?.index, 1);
      assert.strictEqual(world.systems.byId.get("third")?.index, 2);
    });
  });

  describe("Registration Validation", () => {
    it("throws TypeError for anonymous functions", () => {
      const world = createWorld();

      assert.throws(() => addSystem(world, () => {}), TypeError);
    });

    it("throws TypeError for anonymous function expression", () => {
      const world = createWorld();

      // biome-ignore lint/complexity/useArrowFunction: testing anonymous function expression specifically
      const anonymous = function () {};

      assert.throws(() => addSystem(world, anonymous), TypeError);
    });

    it("throws Error for duplicate system name", () => {
      const world = createWorld();

      function physicsSystem() {}
      addSystem(world, physicsSystem);

      assert.throws(() => addSystem(world, physicsSystem), /already registered/i);
    });
  });

  describe("Schedule Ordering", () => {
    it("respects before constraint", () => {
      const world = createWorld();

      function render() {}
      function physics() {}

      addSystem(world, render);
      addSystem(world, physics, { before: "render" });

      buildSchedule(world);

      const order = world.schedules.byId.get("runtime");
      assert.deepStrictEqual(order, ["physics", "render"]);
    });

    it("respects after constraint", () => {
      const world = createWorld();

      function physics() {}
      function input() {}

      addSystem(world, physics);
      addSystem(world, input);
      addSystem(world, physics, { name: "render", after: "physics" });

      buildSchedule(world);

      const order = world.schedules.byId.get("runtime");
      assert.strictEqual(order?.indexOf("physics"), 0);
      assert.strictEqual(order?.indexOf("render"), 2);
    });

    it("uses registration order as tiebreaker", () => {
      const world = createWorld();

      function a() {}
      function b() {}
      function c() {}

      // No constraints - should preserve registration order
      addSystem(world, a);
      addSystem(world, b);
      addSystem(world, c);

      buildSchedule(world);

      assert.deepStrictEqual(world.schedules.byId.get("runtime"), ["a", "b", "c"]);
    });

    it("builds empty schedule when no systems registered", () => {
      const world = createWorld();

      buildSchedule(world);

      assert.deepStrictEqual(world.schedules.byId.get("runtime"), []);
    });

    it("isolates systems by schedule", () => {
      const world = createWorld();

      function startup() {}
      function runtime() {}

      addSystem(world, startup, { schedule: "startup" });
      addSystem(world, runtime, { schedule: "runtime" });

      buildSchedule(world, "startup");
      buildSchedule(world, "runtime");

      assert.deepStrictEqual(world.schedules.byId.get("startup"), ["startup"]);
      assert.deepStrictEqual(world.schedules.byId.get("runtime"), ["runtime"]);
    });
  });

  describe("Schedule Validation", () => {
    it("throws on circular dependency", () => {
      const world = createWorld();

      function a() {}
      function b() {}

      addSystem(world, a, { before: "b" });
      addSystem(world, b, { before: "a" });

      assert.throws(() => buildSchedule(world), /circular/i);
    });

    it("throws on unknown system reference", () => {
      const world = createWorld();

      function system() {}
      addSystem(world, system, { after: "nonexistent" });

      assert.throws(() => buildSchedule(world), /unknown.*nonexistent/i);
    });

    it("throws for before constraint referencing unknown system", () => {
      const world = createWorld();

      function system() {}
      addSystem(world, system, { before: "nonexistent" });

      assert.throws(() => buildSchedule(world), /unknown.*nonexistent/i);
    });
  });

  describe("Schedule Execution", () => {
    it("executes systems in constraint order", () => {
      const world = createWorld();
      const calls: string[] = [];

      // Register in reverse order, but constrain to run first->second->third
      addSystem(world, function third() {
        calls.push("third");
      });
      addSystem(
        world,
        function second() {
          calls.push("second");
        },
        { before: "third" }
      );
      addSystem(
        world,
        function first() {
          calls.push("first");
        },
        { before: "second" }
      );

      buildSchedule(world);
      executeSchedule(world);

      assert.deepStrictEqual(calls, ["first", "second", "third"]);
    });

    it("increments tick each execution", () => {
      const world = createWorld();

      function noop() {}
      addSystem(world, noop);
      buildSchedule(world);

      assert.strictEqual(world.execution.tick, 1);

      // 1 system: tick advances by 2 (per-system + post-bump)
      executeSchedule(world);
      assert.strictEqual(world.execution.tick, 3);

      executeSchedule(world);
      assert.strictEqual(world.execution.tick, 5);
    });

    it("tick advances per system within a schedule", () => {
      const world = createWorld();
      const ticks: number[] = [];

      addSystem(world, function sys1() {
        ticks.push(world.execution.tick);
      });
      addSystem(world, function sys2() {
        ticks.push(world.execution.tick);
      });
      addSystem(world, function sys3() {
        ticks.push(world.execution.tick);
      });

      buildSchedule(world);
      executeSchedule(world);

      // 3 systems see ticks 2, 3, 4; final tick is 5 (post-bump)
      assert.deepStrictEqual(ticks, [2, 3, 4]);
      assert.strictEqual(world.execution.tick, 5);
    });

    it("empty schedule advances tick by post-bump only", () => {
      const world = createWorld();

      buildSchedule(world); // empty schedule

      assert.strictEqual(world.execution.tick, 1);

      executeSchedule(world);
      assert.strictEqual(world.execution.tick, 2);
    });

    it("sets execution context during system run", () => {
      const world = createWorld();
      let capturedSchedule: string | null = null;
      let capturedSystem: string | null = null;

      addSystem(world, function capture() {
        capturedSchedule = world.execution.scheduleId;
        capturedSystem = world.execution.systemId;
      });

      buildSchedule(world);
      executeSchedule(world);

      assert.strictEqual(capturedSchedule, "runtime");
      assert.strictEqual(capturedSystem, "capture");
    });

    it("clears execution context after completion", () => {
      const world = createWorld();

      function noop() {}
      addSystem(world, noop);
      buildSchedule(world);
      executeSchedule(world);

      assert.strictEqual(world.execution.scheduleId, null);
      assert.strictEqual(world.execution.systemId, null);
    });

    it("throws if schedule not built", () => {
      const world = createWorld();

      assert.throws(() => executeSchedule(world), /not built/i);
    });

    it("throws if sync execution encounters Promise", () => {
      const world = createWorld();

      addSystem(world, async function asyncSystem() {
        await Promise.resolve();
      });

      buildSchedule(world);

      assert.throws(() => executeSchedule(world), /Promise.*runScheduleAsync/i);
    });
  });

  describe("Async Execution", () => {
    it("awaits async systems", async () => {
      const world = createWorld();
      const calls: string[] = [];

      addSystem(world, async function asyncSystem() {
        await Promise.resolve();
        calls.push("async");
      });
      addSystem(world, function syncSystem() {
        calls.push("sync");
      });

      buildSchedule(world);
      await executeScheduleAsync(world);

      assert.deepStrictEqual(calls, ["async", "sync"]);
    });

    it("clears context after async completion", async () => {
      const world = createWorld();

      addSystem(world, async function asyncSystem() {
        await Promise.resolve();
      });

      buildSchedule(world);
      await executeScheduleAsync(world);

      assert.strictEqual(world.execution.scheduleId, null);
      assert.strictEqual(world.execution.systemId, null);
    });

    it("throws for unbuilt schedule", async () => {
      const world = createWorld();

      await assert.rejects(executeScheduleAsync(world, "unbuilt"), /not built/i);
    });
  });

  describe("Binary Search Coverage", () => {
    it("binary search inserts system with lower index into queue", () => {
      const world = createWorld();
      const calls: string[] = [];

      // D (index 0) depends on both B and C
      addSystem(
        world,
        function systemD() {
          calls.push("D");
        },
        { after: ["systemB", "systemC"] }
      );

      // C (index 1) no deps
      addSystem(world, function systemC() {
        calls.push("C");
      });

      // B (index 2) no deps
      addSystem(world, function systemB() {
        calls.push("B");
      });

      // A (index 3) no deps
      addSystem(world, function systemA() {
        calls.push("A");
      });

      buildSchedule(world);
      executeSchedule(world);

      // Initial queue (zero in-degree): C (1), B (2), A (3)
      // Process C: D's in-degree 2->1. Queue = [B, A]
      // Process B: D's in-degree 1->0. Insert D (index 0) into queue [A (index 3)]
      //   - mid = 0, A.index (3) >= D.index (0) => high = mid (line 230-231 executed!)
      //   - Queue becomes [D, A]
      // Process D: Queue = [A]
      // Process A: Queue = []

      assert.deepStrictEqual(calls, ["C", "B", "D", "A"]);
    });
  });
});
