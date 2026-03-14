import assert from "node:assert";
import { describe, it } from "node:test";
import { addComponent, getComponentValue } from "./component.js";
import { createEntity } from "./entity.js";
import { Duplicate, InvalidArgument, InvalidState, NotFound } from "./error.js";
import { registerObserverCallback } from "./observer.js";
import { ensureQuery, queryEntities } from "./query.js";
import { defineComponent } from "./registry.js";
import { addResource, getResourceValue } from "./resource.js";
import type { ScheduleLabel } from "./scheduler.js";
import {
  addSystem,
  defineSchedule,
  defineSystem,
  First,
  insertScheduleAfter,
  insertScheduleBefore,
  Last,
  PostUpdate,
  PreUpdate,
  runOnce,
  Shutdown,
  Startup,
  stop,
  Update,
} from "./scheduler.js";
import { Type } from "./schema.js";
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

    it("defaults schedule to Update", () => {
      const world = createWorld();

      function physicsSystem() {}
      addSystem(world, physicsSystem);

      assert.strictEqual(world.systems.byId.get("physicsSystem")?.schedule, Update);
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
  });

  describe("Registration Validation", () => {
    it("throws InvalidArgument for anonymous functions", () => {
      const world = createWorld();

      assert.throws(() => addSystem(world, () => {}), InvalidArgument);
    });

    it("throws InvalidArgument for anonymous function expression", () => {
      const world = createWorld();

      // biome-ignore lint/complexity/useArrowFunction: testing anonymous function expression specifically
      const anonymous = function () {};

      assert.throws(() => addSystem(world, anonymous), InvalidArgument);
    });

    it("throws Duplicate for duplicate system name", () => {
      const world = createWorld();

      function physicsSystem() {}
      addSystem(world, physicsSystem);

      assert.throws(() => addSystem(world, physicsSystem), Duplicate);
    });
  });

  describe("Schedule Ordering", () => {
    it("respects before constraint", async () => {
      const world = createWorld();
      const calls: string[] = [];

      addSystem(world, function render() {
        calls.push("render");
      });
      addSystem(
        world,
        function physics() {
          calls.push("physics");
        },
        { before: "render" }
      );

      await runOnce(world);

      assert.deepStrictEqual(calls, ["physics", "render"]);
    });

    it("respects after constraint", async () => {
      const world = createWorld();
      const calls: string[] = [];

      addSystem(world, function physics() {
        calls.push("physics");
      });
      addSystem(world, function input() {
        calls.push("input");
      });
      addSystem(
        world,
        function render() {
          calls.push("render");
        },
        { after: "physics" }
      );

      await runOnce(world);

      assert.strictEqual(calls.indexOf("physics") < calls.indexOf("render"), true);
    });

    it("uses registration order as tiebreaker", async () => {
      const world = createWorld();
      const calls: string[] = [];

      // No constraints - should preserve registration order
      addSystem(world, function a() {
        calls.push("a");
      });
      addSystem(world, function b() {
        calls.push("b");
      });
      addSystem(world, function c() {
        calls.push("c");
      });

      await runOnce(world);

      assert.deepStrictEqual(calls, ["a", "b", "c"]);
    });

    it("runs with no systems registered", async () => {
      const world = createWorld();

      // Should not throw
      await runOnce(world);
    });

    it("isolates systems by schedule", async () => {
      const world = createWorld();
      const calls: string[] = [];

      addSystem(
        world,
        function startupSys() {
          calls.push("startup");
        },
        { schedule: Startup }
      );
      addSystem(world, function updateSys() {
        calls.push("update");
      });

      await runOnce(world);

      // Startup runs first, then Update schedule
      assert.deepStrictEqual(calls, ["startup", "update"]);
    });
  });

  describe("Schedule Validation", () => {
    it("throws on circular dependency", async () => {
      const world = createWorld();

      function a() {}
      function b() {}

      addSystem(world, a, { before: "b" });
      addSystem(world, b, { before: "a" });

      await assert.rejects(runOnce(world), (err) => err instanceof InvalidState);
    });

    it("throws on unknown system reference in before or after", async () => {
      const world1 = createWorld();
      function system1() {}
      addSystem(world1, system1, { after: "nonexistent" });
      await assert.rejects(runOnce(world1), (err) => err instanceof NotFound);

      const world2 = createWorld();
      function system2() {}
      addSystem(world2, system2, { before: "nonexistent" });
      await assert.rejects(runOnce(world2), (err) => err instanceof NotFound);
    });
  });

  describe("Schedule Execution", () => {
    it("executes systems in constraint order", async () => {
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

      await runOnce(world);

      assert.deepStrictEqual(calls, ["first", "second", "third"]);
    });

    it("increments tick per system", async () => {
      const world = createWorld();

      function noop() {}
      addSystem(world, noop);

      assert.strictEqual(world.execution.tick, 1);

      await runOnce(world);

      // 1 system in Update: tick advances by 2 (per-system + post-bump)
      // But Startup also ran (empty, no tick change)
      // Tick: start=1, Update system tick+1=2, post-bump tick+1=3
      assert.strictEqual(world.execution.tick, 3);
    });

    it("tick advances per system within a schedule", async () => {
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

      await runOnce(world);

      // 3 systems see ticks 2, 3, 4; final tick is 5 (post-bump)
      assert.deepStrictEqual(ticks, [2, 3, 4]);
      assert.strictEqual(world.execution.tick, 5);
    });

    it("sets execution context during system run", async () => {
      const world = createWorld();
      let capturedSchedule: string | null = null;
      let capturedSystem: string | null = null;

      addSystem(world, function capture() {
        capturedSchedule = world.execution.scheduleLabel;
        capturedSystem = world.execution.systemId;
      });

      await runOnce(world);

      assert.strictEqual(capturedSchedule, Update);
      assert.strictEqual(capturedSystem, "capture");
    });

    it("clears execution context after completion", async () => {
      const world = createWorld();

      function noop() {}
      addSystem(world, noop);

      await runOnce(world);

      assert.strictEqual(world.execution.scheduleLabel, null);
      assert.strictEqual(world.execution.systemId, null);
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

      await runOnce(world);

      assert.deepStrictEqual(calls, ["async", "sync"]);
    });

    it("clears context after async completion", async () => {
      const world = createWorld();

      addSystem(world, async function asyncSystem() {
        await Promise.resolve();
      });

      await runOnce(world);

      assert.strictEqual(world.execution.scheduleLabel, null);
      assert.strictEqual(world.execution.systemId, null);
    });
  });

  describe("Binary Search Coverage", () => {
    it("binary search inserts system with lower index into queue", async () => {
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

      await runOnce(world);

      // Initial queue (zero in-degree): C (1), B (2), A (3)
      // Process C: D's in-degree 2->1. Queue = [B, A]
      // Process B: D's in-degree 1->0. Insert D (index 0) into queue [A (index 3)]
      //   - mid = 0, A.index (3) >= D.index (0) => high = mid
      //   - Queue becomes [D, A]
      // Process D: Queue = [A]
      // Process A: Queue = []

      assert.deepStrictEqual(calls, ["C", "B", "D", "A"]);
    });
  });

  describe("Schedule Labels", () => {
    it("built-in labels are distinct strings", () => {
      const labels = [First, PreUpdate, Update, PostUpdate, Last, Startup, Shutdown];
      const unique = new Set(labels);

      assert.strictEqual(unique.size, labels.length);
    });

    it("defineSchedule creates custom label", () => {
      const Physics = defineSchedule("Physics");

      assert.strictEqual(Physics as string, "Physics");
    });
  });

  describe("Pipeline Management", () => {
    it("default pipeline is First, PreUpdate, Update, PostUpdate, Last", () => {
      const world = createWorld();

      assert.deepStrictEqual(world.schedules.pipeline, [First, PreUpdate, Update, PostUpdate, Last]);
    });

    it("insertScheduleBefore inserts at correct position", () => {
      const world = createWorld();
      const Physics = defineSchedule("Physics");

      insertScheduleBefore(world, Physics, Update);

      assert.deepStrictEqual(world.schedules.pipeline, [First, PreUpdate, Physics, Update, PostUpdate, Last]);
    });

    it("insertScheduleAfter inserts at correct position", () => {
      const world = createWorld();
      const Render = defineSchedule("Render");

      insertScheduleAfter(world, Render, PostUpdate);

      assert.deepStrictEqual(world.schedules.pipeline, [First, PreUpdate, Update, PostUpdate, Render, Last]);
    });

    it("throws for unknown anchor or duplicate schedule", () => {
      const world = createWorld();
      const Physics = defineSchedule("Physics");
      const Unknown = defineSchedule("Unknown");

      // Unknown anchor
      assert.throws(() => insertScheduleBefore(world, Physics, Unknown), NotFound);
      assert.throws(() => insertScheduleAfter(world, Physics, Unknown), NotFound);

      // Duplicate schedule
      assert.throws(() => insertScheduleBefore(world, First, Update), Duplicate);
      assert.throws(() => insertScheduleAfter(world, First, Update), Duplicate);
    });

    it("marks pipeline dirty on insert", async () => {
      const world = createWorld();
      await runOnce(world); // clears dirty flag

      const Physics = defineSchedule("Physics");
      insertScheduleBefore(world, Physics, Update);

      assert.strictEqual(world.schedules.dirty, true);
    });
  });

  describe("Pipeline Execution Order", () => {
    it("executes schedules in pipeline order", async () => {
      const world = createWorld();
      const calls: string[] = [];

      addSystem(
        world,
        function firstSys() {
          calls.push("first");
        },
        { schedule: First }
      );
      addSystem(
        world,
        function preUpdateSys() {
          calls.push("preUpdate");
        },
        { schedule: PreUpdate }
      );
      addSystem(world, function updateSys() {
        calls.push("update");
      });
      addSystem(
        world,
        function postUpdateSys() {
          calls.push("postUpdate");
        },
        { schedule: PostUpdate }
      );
      addSystem(
        world,
        function lastSys() {
          calls.push("last");
        },
        { schedule: Last }
      );

      await runOnce(world);

      assert.deepStrictEqual(calls, ["first", "preUpdate", "update", "postUpdate", "last"]);
    });

    it("runs custom schedule in correct pipeline position", async () => {
      const world = createWorld();
      const calls: string[] = [];
      const Physics = defineSchedule("Physics");

      insertScheduleBefore(world, Physics, Update);

      addSystem(
        world,
        function physicsSys() {
          calls.push("physics");
        },
        { schedule: Physics }
      );
      addSystem(world, function updateSys() {
        calls.push("update");
      });

      await runOnce(world);

      assert.strictEqual(calls.indexOf("physics") < calls.indexOf("update"), true);
    });
  });

  describe("Startup and Shutdown", () => {
    it("startup runs once before first frame", async () => {
      const world = createWorld();
      let startupCount = 0;
      let updateCount = 0;

      addSystem(
        world,
        function startupSys() {
          startupCount++;
        },
        { schedule: Startup }
      );
      addSystem(world, function updateSys() {
        updateCount++;
      });

      await runOnce(world);
      await runOnce(world);
      await runOnce(world);

      assert.strictEqual(startupCount, 1);
      assert.strictEqual(updateCount, 3);
    });

    it("shutdown runs once on stop", async () => {
      const world = createWorld();
      let shutdownCount = 0;

      addSystem(
        world,
        function shutdownSys() {
          shutdownCount++;
        },
        { schedule: Shutdown }
      );

      await runOnce(world);
      await stop(world);

      assert.strictEqual(shutdownCount, 1);
    });

    it("shutdown does not run again on second stop", async () => {
      const world = createWorld();
      let shutdownCount = 0;

      addSystem(
        world,
        function shutdownSys() {
          shutdownCount++;
        },
        { schedule: Shutdown }
      );

      await runOnce(world);
      await stop(world);
      await stop(world);

      assert.strictEqual(shutdownCount, 1);
    });

    it("startup runs before pipeline schedules", async () => {
      const world = createWorld();
      const calls: string[] = [];

      addSystem(
        world,
        function startupSys() {
          calls.push("startup");
        },
        { schedule: Startup }
      );
      addSystem(world, function updateSys() {
        calls.push("update");
      });

      await runOnce(world);

      assert.strictEqual(calls[0], "startup");
      assert.strictEqual(calls[1], "update");
    });

    it("stop then runOnce re-triggers startup and shutdown", async () => {
      const world = createWorld();
      let startupCount = 0;
      let shutdownCount = 0;

      addSystem(
        world,
        function startupSys() {
          startupCount++;
        },
        { schedule: Startup }
      );
      addSystem(
        world,
        function shutdownSys() {
          shutdownCount++;
        },
        { schedule: Shutdown }
      );

      // First cycle
      await runOnce(world);
      assert.strictEqual(startupCount, 1);
      await stop(world);
      assert.strictEqual(shutdownCount, 1);

      // Second cycle: startup and shutdown should re-trigger
      await runOnce(world);
      assert.strictEqual(startupCount, 2);
      await stop(world);
      assert.strictEqual(shutdownCount, 2);
    });
  });

  describe("Auto-rebuild", () => {
    it("rebuilds pipeline when dirty", async () => {
      const world = createWorld();
      const calls: string[] = [];

      addSystem(world, function first() {
        calls.push("first");
      });

      await runOnce(world);
      assert.deepStrictEqual(calls, ["first"]);

      // Add new system after first run
      addSystem(world, function second() {
        calls.push("second");
      });

      calls.length = 0;
      await runOnce(world);

      assert.deepStrictEqual(calls, ["first", "second"]);
    });
  });

  describe("defineSystem", () => {
    it("init runs at addSystem time, not at runOnce time", () => {
      const world = createWorld();
      let initCount = 0;

      const factory = defineSystem("testSystem", () => {
        initCount++;
        return () => {};
      });

      assert.strictEqual(initCount, 0);
      addSystem(world, factory);
      assert.strictEqual(initCount, 1);
    });

    it("tick runs every frame", async () => {
      const world = createWorld();
      let tickCount = 0;

      const factory = defineSystem("testSystem", () => {
        return () => {
          tickCount++;
        };
      });

      addSystem(world, factory);

      await runOnce(world);
      await runOnce(world);
      await runOnce(world);

      assert.strictEqual(tickCount, 3);
    });

    it("init runs once, tick runs many", async () => {
      const world = createWorld();
      let initCount = 0;
      let tickCount = 0;

      const factory = defineSystem("testSystem", () => {
        initCount++;
        return () => {
          tickCount++;
        };
      });

      addSystem(world, factory);

      await runOnce(world);
      await runOnce(world);
      await runOnce(world);

      assert.strictEqual(initCount, 1);
      assert.strictEqual(tickCount, 3);
    });

    it("captures world in closure for resource access", async () => {
      const world = createWorld();
      const Time = defineComponent("Time", { delta: Type.f32() });
      addResource(world, Time, { delta: 16 });

      let captured = 0;

      const factory = defineSystem("testSystem", (w) => {
        return () => {
          captured = getResourceValue(w, Time, "delta")!;
        };
      });

      addSystem(world, factory);
      await runOnce(world);

      assert.strictEqual(captured, 16);
    });

    it("query caching in init works with tick iteration", async () => {
      const world = createWorld();
      const Position = defineComponent("Position", { x: Type.f32() });
      const found: number[] = [];

      const factory = defineSystem("testSystem", (w) => {
        const q = ensureQuery(w, Position);
        return () => {
          queryEntities(w, q, (entity) => {
            found.push(getComponentValue(w, entity, Position, "x")!);
          });
        };
      });

      addSystem(world, factory);

      const e = createEntity(world);
      addComponent(world, e, Position, { x: 42 });

      await runOnce(world);

      assert.deepStrictEqual(found, [42]);
    });

    it("system name comes from defineSystem", () => {
      const world = createWorld();

      const factory = defineSystem("mySystem", () => {
        return () => {};
      });

      addSystem(world, factory);

      assert.strictEqual(world.systems.byId.has("mySystem"), true);
    });

    it("options.name overrides factory name", () => {
      const world = createWorld();

      const factory = defineSystem("originalName", () => {
        return () => {};
      });

      addSystem(world, factory, { name: "customName" });

      assert.strictEqual(world.systems.byId.has("customName"), true);
      assert.strictEqual(world.systems.byId.has("originalName"), false);
    });

    it("schedule option works", async () => {
      const world = createWorld();
      const calls: string[] = [];

      addSystem(world, function updateSys() {
        calls.push("update");
      });

      const factory = defineSystem("firstSys", () => {
        return () => {
          calls.push("first");
        };
      });

      addSystem(world, factory, { schedule: First });

      await runOnce(world);

      assert.strictEqual(calls.indexOf("first") < calls.indexOf("update"), true);
    });

    it("before/after constraints work", async () => {
      const world = createWorld();
      const calls: string[] = [];

      addSystem(world, function render() {
        calls.push("render");
      });

      const factory = defineSystem("physics", () => {
        return () => {
          calls.push("physics");
        };
      });

      addSystem(world, factory, { before: "render" });

      await runOnce(world);

      assert.deepStrictEqual(calls, ["physics", "render"]);
    });

    it("awaits async tick functions", async () => {
      const world = createWorld();
      const calls: string[] = [];

      const factory = defineSystem("asyncSys", () => {
        return async () => {
          await Promise.resolve();
          calls.push("async");
        };
      });

      addSystem(world, function syncSys() {
        calls.push("sync");
      });

      addSystem(world, factory, { before: "syncSys" });

      await runOnce(world);

      assert.deepStrictEqual(calls, ["async", "sync"]);
    });

    it("sets execution context correctly during tick", async () => {
      const world = createWorld();
      let capturedSchedule: string | null = null;
      let capturedSystem: string | null = null;

      const factory = defineSystem("capture", () => {
        return () => {
          capturedSchedule = world.execution.scheduleLabel;
          capturedSystem = world.execution.systemId;
        };
      });

      addSystem(world, factory);

      await runOnce(world);

      assert.strictEqual(capturedSchedule, Update);
      assert.strictEqual(capturedSystem, "capture");
    });

    it("plain SystemRunner and SystemFactory coexist in same schedule", async () => {
      const world = createWorld();
      const calls: string[] = [];

      addSystem(world, function plain() {
        calls.push("plain");
      });

      const factory = defineSystem("factory", () => {
        return () => {
          calls.push("factory");
        };
      });

      addSystem(world, factory, { after: "plain" });

      await runOnce(world);

      assert.deepStrictEqual(calls, ["plain", "factory"]);
    });

    it("throws Duplicate for same factory name registered twice", () => {
      const world = createWorld();

      const factory = defineSystem("dupe", () => {
        return () => {};
      });

      addSystem(world, factory);

      assert.throws(() => addSystem(world, factory), Duplicate);
    });

    it("allows same factory registered with different names", () => {
      const world = createWorld();

      const factory = defineSystem("original", () => {
        return () => {};
      });

      addSystem(world, factory, { name: "instance1" });
      addSystem(world, factory, { name: "instance2" });

      assert.strictEqual(world.systems.byId.size, 2);
    });

    it("local state persists across ticks", async () => {
      const world = createWorld();
      const values: number[] = [];

      const factory = defineSystem("counter", () => {
        let count = 0;
        return () => {
          count++;
          values.push(count);
        };
      });

      addSystem(world, factory);

      await runOnce(world);
      await runOnce(world);
      await runOnce(world);

      assert.deepStrictEqual(values, [1, 2, 3]);
    });
  });

  describe("Schedule Instrumentation", () => {
    it("fires scheduleStarted before system execution", async () => {
      const world = createWorld();
      const events: ScheduleLabel[] = [];

      registerObserverCallback(world, "scheduleStarted", (label) => {
        events.push(label);
      });

      addSystem(world, function noop() {});

      await runOnce(world);

      // Update schedule has a system so it fires; empty schedules do not fire
      assert.strictEqual(events.includes(Update), true);
    });

    it("fires scheduleFinished after all systems complete", async () => {
      const world = createWorld();
      const events: { label: ScheduleLabel; duration: number }[] = [];

      registerObserverCallback(world, "scheduleFinished", (label, duration) => {
        events.push({ label, duration });
      });

      addSystem(world, function noop() {});

      await runOnce(world);

      const updateEvent = events.find((e) => e.label === Update);
      assert.notStrictEqual(updateEvent, undefined);
      assert.strictEqual(typeof updateEvent!.duration, "number");
      assert.strictEqual(updateEvent!.duration >= 0, true);
    });

    it("fires systemStarted and systemFinished around each system", async () => {
      const world = createWorld();
      const started: { systemId: string; schedule: ScheduleLabel }[] = [];
      const finished: { systemId: string; schedule: ScheduleLabel; duration: number }[] = [];

      registerObserverCallback(world, "systemStarted", (systemId, schedule) => {
        started.push({ systemId, schedule });
      });

      registerObserverCallback(world, "systemFinished", (systemId, schedule, duration) => {
        finished.push({ systemId, schedule, duration });
      });

      addSystem(world, function alpha() {});
      addSystem(world, function beta() {});

      await runOnce(world);

      // Both systems should have started and finished
      assert.strictEqual(
        started.some((e) => e.systemId === "alpha"),
        true
      );
      assert.strictEqual(
        started.some((e) => e.systemId === "beta"),
        true
      );
      assert.strictEqual(
        finished.some((e) => e.systemId === "alpha"),
        true
      );
      assert.strictEqual(
        finished.some((e) => e.systemId === "beta"),
        true
      );

      // Both ran in Update schedule
      assert.strictEqual(started.find((e) => e.systemId === "alpha")!.schedule, Update);
      assert.strictEqual(finished.find((e) => e.systemId === "beta")!.schedule, Update);
    });

    it("systemFinished carries duration in milliseconds", async () => {
      const world = createWorld();
      let capturedDuration = -1;

      registerObserverCallback(world, "systemFinished", (_systemId, _schedule, duration) => {
        capturedDuration = duration;
      });

      addSystem(world, function work() {
        // Burn a tiny amount of time
        let sum = 0;
        for (let i = 0; i < 1000; i++) sum += i;
        void sum;
      });

      await runOnce(world);

      assert.strictEqual(capturedDuration >= 0, true);
    });

    it("system events fire in correct order relative to execution", async () => {
      const world = createWorld();
      const log: string[] = [];

      registerObserverCallback(world, "scheduleStarted", () => {
        log.push("schedule-start");
      });
      registerObserverCallback(world, "systemStarted", (systemId) => {
        log.push(`system-start:${systemId}`);
      });
      registerObserverCallback(world, "systemFinished", (systemId) => {
        log.push(`system-end:${systemId}`);
      });
      registerObserverCallback(world, "scheduleFinished", () => {
        log.push("schedule-end");
      });

      addSystem(world, function mySystem() {
        log.push("run:mySystem");
      });

      await runOnce(world);

      // Filter to only Update schedule events (skip Startup and empty schedules)
      const updateIdx = log.indexOf("system-start:mySystem");
      assert.notStrictEqual(updateIdx, -1);

      // system-start comes before run, run comes before system-end
      const runIdx = log.indexOf("run:mySystem");
      const endIdx = log.indexOf("system-end:mySystem");
      assert.strictEqual(updateIdx < runIdx, true);
      assert.strictEqual(runIdx < endIdx, true);
    });

    it("empty schedules do not fire events", async () => {
      const world = createWorld();
      const events: ScheduleLabel[] = [];

      registerObserverCallback(world, "scheduleStarted", (label) => {
        events.push(label);
      });

      // No systems registered
      await runOnce(world);

      // Empty schedules should not fire events
      assert.strictEqual(events.length, 0);
    });

    it("async system duration includes await time", async () => {
      const world = createWorld();
      let capturedDuration = -1;

      registerObserverCallback(world, "systemFinished", (_systemId, _schedule, duration) => {
        capturedDuration = duration;
      });

      addSystem(world, async function asyncWork() {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      await runOnce(world);

      // Duration should include the 10ms+ await
      assert.strictEqual(capturedDuration >= 5, true);
    });
  });
});
