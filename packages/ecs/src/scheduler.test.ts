import assert from "node:assert";
import { describe, it } from "node:test";
import { defineCondition } from "./conditions.js";
import { IrisDuplicate, IrisInvalidState, IrisInvalidSystemName, IrisLimitExceeded, IrisNotFound } from "./error.js";
import { registerObserverCallback } from "./observer.js";
import type { FrameDriver, ScheduleLabel } from "./scheduler.js";
import {
  addSystem,
  addSystemSet,
  addSystems,
  createTimeoutDriver,
  defineSchedule,
  defineSystem,
  defineSystemSet,
  First,
  insertScheduleAfter,
  insertScheduleBefore,
  Last,
  PostUpdate,
  PreUpdate,
  run,
  runOnce,
  Shutdown,
  Startup,
  stop,
  suspend,
  Update,
} from "./scheduler.js";
import { createWorld, resetWorld } from "./world.js";

function mockAnimationFrame(): { hasFrame: () => boolean; runFrame: () => Promise<void>; restore: () => void } {
  const request = globalThis.requestAnimationFrame;
  const cancel = globalThis.cancelAnimationFrame;
  let callback: ((time: number) => Promise<void>) | null = null;

  globalThis.requestAnimationFrame = (next) => {
    callback = next as (time: number) => Promise<void>;
    return 1;
  };
  globalThis.cancelAnimationFrame = () => {
    callback = null;
  };

  return {
    hasFrame: () => callback !== null,
    runFrame: () => {
      const frame = callback!;
      callback = null;
      return frame(0);
    },
    restore: () => {
      globalThis.requestAnimationFrame = request;
      globalThis.cancelAnimationFrame = cancel;
    },
  };
}

describe("Scheduler", () => {
  describe("System Registration", () => {
    it("uses the system definition name as its identifier", () => {
      const world = createWorld();
      const physicsSystem = defineSystem("physicsSystem", () => {});
      addSystem(world, physicsSystem);

      assert.strictEqual(world.systems.byId.has("physicsSystem"), true);
    });

    it("uses options.name over the definition name", () => {
      const world = createWorld();
      const physicsSystem = defineSystem("physicsSystem", () => {});
      addSystem(world, physicsSystem, { name: "customName" });

      assert.strictEqual(world.systems.byId.has("customName"), true);
      assert.strictEqual(world.systems.byId.has("physicsSystem"), false);
    });

    it("allows the same system registered with different names", () => {
      const world = createWorld();
      const physicsSystem = defineSystem("physicsSystem", () => {});
      addSystem(world, physicsSystem, { name: "physics-objects" });
      addSystem(world, physicsSystem, { name: "physics-particles" });

      assert.strictEqual(world.systems.byId.size, 2);
    });

    it("defaults schedule to Update", () => {
      const world = createWorld();
      const physicsSystem = defineSystem("physicsSystem", () => {});
      addSystem(world, physicsSystem);

      assert.strictEqual(world.systems.byId.get("physicsSystem")?.schedule, Update);
    });

    it("extracts name from a single system constraint", () => {
      const world = createWorld();

      const other = defineSystem("other", () => {});
      const another = defineSystem("another", () => {});
      const system = defineSystem("system", () => {});
      addSystem(world, system, { before: other, after: another });

      const meta = world.systems.byId.get("system");
      assert.deepStrictEqual(meta?.before, ["other"]);
      assert.deepStrictEqual(meta?.after, ["another"]);
    });

    it("extracts names from system array constraints", () => {
      const world = createWorld();

      const a = defineSystem("a", () => {});
      const b = defineSystem("b", () => {});
      const c = defineSystem("c", () => {});
      const d = defineSystem("d", () => {});
      const system = defineSystem("system", () => {});
      addSystem(world, system, { before: [a, b], after: [c, d] });

      const meta = world.systems.byId.get("system");
      assert.deepStrictEqual(meta?.before, ["a", "b"]);
      assert.deepStrictEqual(meta?.after, ["c", "d"]);
    });

    it("registers a batch in order under shared options", async () => {
      const world = createWorld();
      const calls: string[] = [];
      const track = (label: string) =>
        defineSystem(label, () => {
          void calls.push(label);
        });

      addSystems(world, [track("a"), track("b"), track("c")], { schedule: PostUpdate });

      await runOnce(world);

      assert.deepStrictEqual(calls, ["a", "b", "c"]);
      assert.strictEqual(world.systems.byId.get("b")?.schedule, PostUpdate);
    });

    it("applies batch constraints to every system", () => {
      const world = createWorld();

      const anchor = defineSystem("anchor", () => {});
      addSystems(world, [defineSystem("a", () => {}), defineSystem("b", () => {})], { after: anchor });

      assert.deepStrictEqual(world.systems.byId.get("a")?.after, ["anchor"]);
      assert.deepStrictEqual(world.systems.byId.get("b")?.after, ["anchor"]);
    });

    it("throws IrisDuplicate when a batch repeats a name", () => {
      const world = createWorld();

      const sys = defineSystem("sys", () => {});

      assert.throws(() => addSystems(world, [sys, sys]), IrisDuplicate);
    });

    it("stores before/after as string arrays from string references", () => {
      const world = createWorld();

      const system = defineSystem("system", () => {});
      addSystem(world, system, { before: "target1", after: ["target2", "target3"] });

      const meta = world.systems.byId.get("system");
      assert.deepStrictEqual(meta?.before, ["target1"]);
      assert.deepStrictEqual(meta?.after, ["target2", "target3"]);
    });
  });

  describe("Registration Validation", () => {
    it("throws IrisDuplicate for duplicate system name", () => {
      const world = createWorld();
      const physicsSystem = defineSystem("physicsSystem", () => {});
      addSystem(world, physicsSystem);

      assert.throws(() => addSystem(world, physicsSystem), IrisDuplicate);
    });

    it("throws IrisDuplicate when system name matches a system set", () => {
      const world = createWorld();
      const Shared = defineSystemSet("shared");
      addSystemSet(world, Shared, { schedule: PostUpdate });

      assert.throws(
        () =>
          addSystem(
            world,
            defineSystem("shared", () => {}),
            { name: "shared" }
          ),
        (error: unknown) => error instanceof IrisDuplicate && error.resource === "SystemSet" && error.id === "shared"
      );
      assert.strictEqual(world.systems.byId.has("shared"), false);
    });
  });

  describe("Schedule Ordering", () => {
    it("respects before constraint", async () => {
      const world = createWorld();
      const calls: string[] = [];

      const render = defineSystem("render", () => {
        calls.push("render");
      });
      const physics = defineSystem("physics", () => {
        calls.push("physics");
      });

      addSystem(world, render);
      addSystem(world, physics, { before: render });

      await runOnce(world);

      assert.deepStrictEqual(calls, ["physics", "render"]);
    });

    it("respects after constraint", async () => {
      const world = createWorld();
      const calls: string[] = [];

      const physics = defineSystem("physics", () => {
        calls.push("physics");
      });

      addSystem(world, physics);
      addSystem(
        world,
        defineSystem("input", function input() {
          calls.push("input");
        })
      );

      const render = defineSystem("render", () => {
        calls.push("render");
      });
      addSystem(world, render, { after: physics });

      await runOnce(world);

      assert.strictEqual(calls.indexOf("physics") < calls.indexOf("render"), true);
    });

    it("uses registration order as tiebreaker", async () => {
      const world = createWorld();
      const calls: string[] = [];

      // No constraints - should preserve registration order
      addSystem(
        world,
        defineSystem("a", function a() {
          calls.push("a");
        })
      );
      addSystem(
        world,
        defineSystem("b", function b() {
          calls.push("b");
        })
      );
      addSystem(
        world,
        defineSystem("c", function c() {
          calls.push("c");
        })
      );

      await runOnce(world);

      assert.deepStrictEqual(calls, ["a", "b", "c"]);
    });

    it("respects combined before and after constraints", async () => {
      const world = createWorld();
      const calls: string[] = [];

      const a = defineSystem("a", () => {
        calls.push("a");
      });
      const b = defineSystem("b", () => {
        calls.push("b");
      });
      const c = defineSystem("c", () => {
        calls.push("c");
      });

      addSystem(world, c);
      addSystem(world, a);
      addSystem(world, b, { after: a, before: c });

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
        defineSystem("startupSys", function startupSys() {
          calls.push("startup");
        }),
        { schedule: Startup }
      );
      addSystem(
        world,
        defineSystem("updateSys", () => {
          calls.push("update");
        })
      );

      await runOnce(world);

      // Startup runs first, then Update schedule
      assert.deepStrictEqual(calls, ["startup", "update"]);
    });
  });

  describe("Schedule Validation", () => {
    it("throws on circular dependency", async () => {
      const world = createWorld();

      const a = defineSystem("a", () => {});
      const b = defineSystem("b", () => {});

      addSystem(world, a, { before: b });
      addSystem(world, b, { before: a });

      await assert.rejects(runOnce(world), (err) => err instanceof IrisInvalidState);
    });

    it("throws on unknown system reference in before or after", async () => {
      const nonexistent = defineSystem("nonexistent", () => {});

      const world1 = createWorld();
      function system1() {}
      addSystem(world1, defineSystem("system1", system1), { after: nonexistent });
      await assert.rejects(runOnce(world1), (err) => err instanceof IrisNotFound);

      const world2 = createWorld();
      function system2() {}
      addSystem(world2, defineSystem("system2", system2), { before: nonexistent });
      await assert.rejects(runOnce(world2), (err) => err instanceof IrisNotFound);
    });

    it("throws IrisNotFound for cross-schedule reference", async () => {
      const world = createWorld();

      const postSys = defineSystem("postSys", () => {});
      addSystem(world, postSys, { schedule: PostUpdate });

      addSystem(
        world,
        defineSystem("updateSys", function updateSys() {}),
        { before: postSys }
      );

      await assert.rejects(runOnce(world), (err) => err instanceof IrisNotFound);
    });
  });

  describe("Schedule Execution", () => {
    it("increments the frame tick once per runOnce", async () => {
      const world = createWorld();

      function noop() {}
      addSystem(world, defineSystem("noop", noop));

      assert.strictEqual(world.execution.tick, 0);
      await runOnce(world);
      assert.strictEqual(world.execution.tick, 1);
      await runOnce(world);
      assert.strictEqual(world.execution.tick, 2);
    });

    it("keeps the frame tick stable within a schedule", async () => {
      const world = createWorld();
      const ticks: number[] = [];

      addSystem(
        world,
        defineSystem("sys1", function sys1() {
          ticks.push(world.execution.tick);
        })
      );
      addSystem(
        world,
        defineSystem("sys2", function sys2() {
          ticks.push(world.execution.tick);
        })
      );
      addSystem(
        world,
        defineSystem("sys3", function sys3() {
          ticks.push(world.execution.tick);
        })
      );

      await runOnce(world);

      assert.deepStrictEqual(ticks, [1, 1, 1]);
      assert.strictEqual(world.execution.tick, 1);
    });

    it("sets execution context during system run", async () => {
      const world = createWorld();
      let capturedSchedule: string | null = null;
      let capturedSystem: string | null = null;

      addSystem(
        world,
        defineSystem("capture", function capture() {
          capturedSchedule = world.execution.scheduleLabel;
          capturedSystem = world.execution.systemId;
        })
      );

      await runOnce(world);

      assert.strictEqual(capturedSchedule, Update);
      assert.strictEqual(capturedSystem, "capture");
    });

    it("clears execution context after completion", async () => {
      const world = createWorld();

      function noop() {}
      addSystem(world, defineSystem("noop", noop));

      await runOnce(world);

      assert.strictEqual(world.execution.scheduleLabel, null);
      assert.strictEqual(world.execution.systemId, null);
    });

    it("execution context changes per system", async () => {
      const world = createWorld();
      const captured: string[] = [];

      addSystem(
        world,
        defineSystem("alpha", function alpha() {
          captured.push(world.execution.systemId!);
        })
      );
      addSystem(
        world,
        defineSystem("beta", function beta() {
          captured.push(world.execution.systemId!);
        })
      );

      await runOnce(world);

      assert.deepStrictEqual(captured, ["alpha", "beta"]);
    });
  });

  describe("Async Execution", () => {
    it("awaits async systems", async () => {
      const world = createWorld();
      const calls: string[] = [];

      addSystem(
        world,
        defineSystem("asyncSystem", async function asyncSystem() {
          await Promise.resolve();
          calls.push("async");
        })
      );
      addSystem(
        world,
        defineSystem("syncSystem", function syncSystem() {
          calls.push("sync");
        })
      );

      await runOnce(world);

      assert.deepStrictEqual(calls, ["async", "sync"]);
    });

    it("clears context after async completion", async () => {
      const world = createWorld();

      addSystem(
        world,
        defineSystem("asyncSystem", async function asyncSystem() {
          await Promise.resolve();
        })
      );

      await runOnce(world);

      assert.strictEqual(world.execution.scheduleLabel, null);
      assert.strictEqual(world.execution.systemId, null);
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
      assert.throws(() => insertScheduleBefore(world, Physics, Unknown), IrisNotFound);
      assert.throws(() => insertScheduleAfter(world, Physics, Unknown), IrisNotFound);

      // IrisDuplicate schedule
      assert.throws(() => insertScheduleBefore(world, First, Update), IrisDuplicate);
      assert.throws(() => insertScheduleAfter(world, First, Update), IrisDuplicate);
    });

    it("throws when inserting a lifecycle schedule", () => {
      const world = createWorld();

      assert.throws(() => insertScheduleAfter(world, Startup, Update), IrisDuplicate);
      assert.throws(() => insertScheduleBefore(world, Shutdown, Update), IrisDuplicate);
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
        defineSystem("firstSys", function firstSys() {
          calls.push("first");
        }),
        { schedule: First }
      );
      addSystem(
        world,
        defineSystem("preUpdateSys", function preUpdateSys() {
          calls.push("preUpdate");
        }),
        { schedule: PreUpdate }
      );
      addSystem(
        world,
        defineSystem("updateSys", function updateSys() {
          calls.push("update");
        })
      );
      addSystem(
        world,
        defineSystem("postUpdateSys", function postUpdateSys() {
          calls.push("postUpdate");
        }),
        { schedule: PostUpdate }
      );
      addSystem(
        world,
        defineSystem("lastSys", function lastSys() {
          calls.push("last");
        }),
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
        defineSystem("physicsSys", function physicsSys() {
          calls.push("physics");
        }),
        { schedule: Physics }
      );
      addSystem(
        world,
        defineSystem("updateSys", function updateSys() {
          calls.push("update");
        })
      );

      await runOnce(world);

      assert.strictEqual(calls.indexOf("physics") < calls.indexOf("update"), true);
    });

    it("throws for a system registered to a schedule outside the pipeline", async () => {
      const world = createWorld();
      const Physics = defineSchedule("Physics");

      addSystem(
        world,
        defineSystem("physicsSys", function physicsSys() {}),
        { schedule: Physics }
      );

      await assert.rejects(() => runOnce(world), IrisNotFound);
    });

    it("insert from a running system takes effect on the next frame", async () => {
      const world = createWorld();
      const calls: string[] = [];
      const Physics = defineSchedule("Physics");

      addSystem(
        world,
        defineSystem("updateSys", () => {
          calls.push("update");

          if (!world.schedules.pipeline.includes(Physics)) {
            insertScheduleBefore(world, Physics, First);
            addSystem(
              world,
              defineSystem("physicsSys", () => {
                calls.push("physics");
              }),
              { schedule: Physics }
            );
          }
        })
      );

      await runOnce(world);
      await runOnce(world);

      assert.deepStrictEqual(calls, ["update", "physics", "update"]);
    });
  });

  describe("Frame Exclusivity", () => {
    it("rejects concurrent manual frames without advancing the tick", async () => {
      const world = createWorld();
      let started!: () => void;
      let release!: () => void;
      const start = new Promise<void>((resolve) => {
        started = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let runs = 0;
      addSystem(
        world,
        defineSystem("updateSys", async function updateSys() {
          runs++;
          if (runs === 1) {
            started();
            await gate;
          }
        })
      );

      const frame = runOnce(world);
      await start;

      await assert.rejects(runOnce(world), IrisInvalidState);
      assert.strictEqual(world.execution.tick, 1);

      release();
      await frame;
      await runOnce(world);
      assert.strictEqual(runs, 2);
      assert.strictEqual(world.execution.tick, 2);
    });

    it("rejects reentrant frames without deadlocking", async () => {
      const world = createWorld();
      addSystem(
        world,
        defineSystem("updateSys", async function updateSys() {
          await runOnce(world);
        })
      );

      await assert.rejects(runOnce(world), IrisInvalidState);
      assert.strictEqual(world.execution.framePromise, null);
    });

    it("rejects concurrent manual frames admitted in the same task", async () => {
      const world = createWorld();
      let runs = 0;
      addSystem(
        world,
        defineSystem("updateSys", function updateSys() {
          runs++;
        })
      );

      const first = runOnce(world);
      const second = runOnce(world);

      await Promise.all([first, assert.rejects(second, IrisInvalidState)]);
      assert.strictEqual(runs, 1);
      assert.strictEqual(world.execution.tick, 1);
    });

    it("rejects manual frames while the animation frame loop is running", async () => {
      const animationFrame = mockAnimationFrame();

      try {
        const world = createWorld();
        run(world);

        await assert.rejects(runOnce(world), IrisInvalidState);
        assert.strictEqual(world.execution.tick, 0);
        await suspend(world);
      } finally {
        animationFrame.restore();
      }
    });

    it("suspend waits for a manual frame", async () => {
      const world = createWorld();
      let started!: () => void;
      let release!: () => void;
      const start = new Promise<void>((resolve) => {
        started = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      addSystem(
        world,
        defineSystem("updateSys", async function updateSys() {
          started();
          await gate;
        })
      );

      const frame = runOnce(world);
      await start;
      const suspension = suspend(world);

      assert.strictEqual(suspension, world.execution.framePromise);
      release();
      await Promise.all([frame, suspension]);
    });

    it("run resumes after a manual frame", async () => {
      const animationFrame = mockAnimationFrame();
      let started!: () => void;
      let release!: () => void;
      const start = new Promise<void>((resolve) => {
        started = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      try {
        const world = createWorld();
        let runs = 0;
        addSystem(
          world,
          defineSystem("updateSys", async function updateSys() {
            runs++;
            if (runs === 1) {
              started();
              await gate;
            }
          })
        );

        const manualFrame = runOnce(world);
        await start;
        run(world);
        assert.strictEqual(animationFrame.hasFrame(), false);

        release();
        await manualFrame;
        assert.strictEqual(animationFrame.hasFrame(), true);

        await animationFrame.runFrame();
        await suspend(world);
        assert.strictEqual(runs, 2);
      } finally {
        release();
        animationFrame.restore();
      }
    });
  });

  describe("Suspension", () => {
    it("resumes without running Startup or Shutdown", async () => {
      const animationFrame = mockAnimationFrame();

      try {
        const world = createWorld();
        let startupCount = 0;
        let updateCount = 0;
        let shutdownCount = 0;
        addSystem(
          world,
          defineSystem("startup", () => {
            startupCount++;
          }),
          { name: "startup", schedule: Startup }
        );
        addSystem(
          world,
          defineSystem("update", () => {
            updateCount++;
          }),
          { name: "update" }
        );
        addSystem(
          world,
          defineSystem("shutdown", () => {
            shutdownCount++;
          }),
          { name: "shutdown", schedule: Shutdown }
        );

        run(world);
        assert.strictEqual(animationFrame.hasFrame(), true);
        await suspend(world);
        assert.strictEqual(animationFrame.hasFrame(), false);

        run(world);
        await animationFrame.runFrame();
        await suspend(world);
        run(world);
        await animationFrame.runFrame();
        await suspend(world);

        assert.strictEqual(startupCount, 1);
        assert.strictEqual(updateCount, 2);
        assert.strictEqual(shutdownCount, 0);

        await stop(world);
        assert.strictEqual(shutdownCount, 1);
      } finally {
        animationFrame.restore();
      }
    });

    it("resumes after an active frame finishes", async () => {
      const animationFrame = mockAnimationFrame();
      let updateStarted!: () => void;
      let releaseUpdate!: () => void;
      const updateStart = new Promise<void>((resolve) => {
        updateStarted = resolve;
      });
      const updateGate = new Promise<void>((resolve) => {
        releaseUpdate = resolve;
      });

      try {
        const world = createWorld();
        let updateCount = 0;
        addSystem(
          world,
          defineSystem("updateSys", async function updateSys() {
            updateCount++;
            if (updateCount === 1) {
              updateStarted();
              await updateGate;
            }
          })
        );

        run(world);
        const frame = animationFrame.runFrame();
        await updateStart;

        const firstSuspend = suspend(world);
        const secondSuspend = suspend(world);
        assert.strictEqual(animationFrame.hasFrame(), false);

        run(world);
        assert.strictEqual(animationFrame.hasFrame(), false);
        releaseUpdate();
        await Promise.all([frame, firstSuspend, secondSuspend]);
        assert.strictEqual(animationFrame.hasFrame(), true);

        await animationFrame.runFrame();
        await suspend(world);
        assert.strictEqual(updateCount, 2);
      } finally {
        releaseUpdate();
        animationFrame.restore();
      }
    });

    it("propagates active frame errors", async () => {
      const animationFrame = mockAnimationFrame();

      try {
        const world = createWorld();
        const error = new Error("frame failed");
        addSystem(
          world,
          defineSystem("updateSys", function updateSys() {
            throw error;
          })
        );

        run(world);
        const frame = animationFrame.runFrame();
        const suspension = suspend(world);

        await Promise.all([
          assert.rejects(frame, (actual) => actual === error),
          assert.rejects(suspension, (actual) => actual === error),
        ]);
        assert.strictEqual(world.execution.running, false);
      } finally {
        animationFrame.restore();
      }
    });

    it("does not block manual frames", async () => {
      const world = createWorld();
      let updateCount = 0;
      addSystem(
        world,
        defineSystem("updateSys", function updateSys() {
          updateCount++;
        })
      );

      await suspend(world);
      await runOnce(world);

      assert.strictEqual(updateCount, 1);
    });

    it("suspends from a sync Startup system after the frame completes", async () => {
      const animationFrame = mockAnimationFrame();

      try {
        const world = createWorld();
        let updates = 0;
        addSystem(
          world,
          defineSystem("startupSys", function startupSys() {
            suspend(world);
          }),
          { schedule: Startup }
        );
        addSystem(
          world,
          defineSystem("updateSys", function updateSys() {
            updates++;
          })
        );

        run(world);
        await animationFrame.runFrame();

        assert.strictEqual(updates, 1);
        assert.strictEqual(world.execution.running, false);
        assert.strictEqual(animationFrame.hasFrame(), false);
      } finally {
        animationFrame.restore();
      }
    });
  });

  describe("Frame Drivers", () => {
    function mockFrameDriver(): {
      driver: FrameDriver;
      hasFrame: () => boolean;
      runFrame: () => Promise<void>;
      cancelled: unknown[];
    } {
      let callback: (() => Promise<void>) | null = null;
      let nextHandle = 0;
      const cancelled: unknown[] = [];

      return {
        driver: {
          request: (next) => {
            callback = next as () => Promise<void>;
            return ++nextHandle;
          },
          cancel: (handle) => {
            cancelled.push(handle);
            callback = null;
          },
        },
        hasFrame: () => callback !== null,
        runFrame: () => {
          const frame = callback!;
          callback = null;
          return frame();
        },
        cancelled,
      };
    }

    it("drives the loop through a custom driver", async () => {
      const frames = mockFrameDriver();
      const world = createWorld();
      let runs = 0;
      addSystem(
        world,
        defineSystem("updateSys", function updateSys() {
          runs++;
        })
      );

      run(world, frames.driver);
      assert.strictEqual(frames.hasFrame(), true);
      await frames.runFrame();

      assert.strictEqual(runs, 1);
      assert.strictEqual(frames.hasFrame(), true);
      await suspend(world);
    });

    it("suspend cancels the pending frame through the driver", async () => {
      const frames = mockFrameDriver();
      const world = createWorld();
      addSystem(
        world,
        defineSystem("updateSys", function updateSys() {})
      );

      run(world, frames.driver);
      await suspend(world);

      assert.deepStrictEqual(frames.cancelled, [1]);
      assert.strictEqual(frames.hasFrame(), false);
    });

    it("resuming accepts a different driver", async () => {
      const first = mockFrameDriver();
      const second = mockFrameDriver();
      const world = createWorld();
      addSystem(
        world,
        defineSystem("updateSys", function updateSys() {})
      );

      run(world, first.driver);
      await suspend(world);
      run(world, second.driver);

      assert.strictEqual(first.hasFrame(), false);
      assert.strictEqual(second.hasFrame(), true);
      await suspend(world);
    });

    it("createTimeoutDriver schedules frames with setTimeout", async () => {
      const world = createWorld();
      const { promise, resolve } = Promise.withResolvers<void>();
      addSystem(
        world,
        defineSystem("updateSys", function updateSys() {
          resolve();
        })
      );

      run(world, createTimeoutDriver(1));
      await promise;
      await suspend(world);
    });
  });

  describe("Frame Failure", () => {
    it("fires frameFailed when a manual frame rejects", async () => {
      const world = createWorld();
      const error = new Error("frame failed");
      const seen: unknown[] = [];

      registerObserverCallback(world, "frameFailed", (err) => {
        seen.push(err);
      });

      addSystem(
        world,
        defineSystem("failingSys", function failingSys() {
          throw error;
        })
      );

      await assert.rejects(runOnce(world), (actual) => actual === error);
      assert.deepStrictEqual(seen, [error]);
    });

    it("fires frameFailed and halts the loop when a loop frame rejects", async () => {
      const animationFrame = mockAnimationFrame();

      try {
        const world = createWorld();
        const error = new Error("frame failed");
        const seen: unknown[] = [];

        registerObserverCallback(world, "frameFailed", (err) => {
          seen.push(err);
        });

        addSystem(
          world,
          defineSystem("failingSys", function failingSys() {
            throw error;
          })
        );

        run(world);
        await animationFrame.runFrame();

        assert.deepStrictEqual(seen, [error]);
        assert.strictEqual(world.execution.running, false);
        assert.strictEqual(animationFrame.hasFrame(), false);
      } finally {
        animationFrame.restore();
      }
    });

    it("rejects the loop frame when no frameFailed observer is registered", async () => {
      const animationFrame = mockAnimationFrame();

      try {
        const world = createWorld();
        const error = new Error("frame failed");

        addSystem(
          world,
          defineSystem("failingSys", function failingSys() {
            throw error;
          })
        );

        run(world);
        await assert.rejects(animationFrame.runFrame(), (actual) => actual === error);
      } finally {
        animationFrame.restore();
      }
    });

    it("resumes the loop when a frameFailed observer calls run", async () => {
      const animationFrame = mockAnimationFrame();

      try {
        const world = createWorld();
        let ticks = 0;

        registerObserverCallback(world, "frameFailed", () => {
          run(world);
        });

        addSystem(
          world,
          defineSystem("flakySys", function flakySys() {
            ticks++;

            if (ticks === 1) {
              throw new Error("frame failed");
            }
          })
        );

        run(world);
        await animationFrame.runFrame();
        assert.strictEqual(animationFrame.hasFrame(), true);

        await animationFrame.runFrame();
        assert.strictEqual(ticks, 2);

        await suspend(world);
      } finally {
        animationFrame.restore();
      }
    });
  });

  describe("Startup and Shutdown", () => {
    it("shares one tick across Startup and pipeline and excludes Shutdown", async () => {
      const world = createWorld();
      const ticks: number[] = [];
      addSystem(
        world,
        defineSystem("startupTick", () => {
          ticks.push(world.execution.tick);
        }),
        { name: "startupTick", schedule: Startup }
      );
      addSystem(
        world,
        defineSystem("firstTick", () => {
          ticks.push(world.execution.tick);
        }),
        { name: "firstTick", schedule: First }
      );
      addSystem(
        world,
        defineSystem("updateTick", () => {
          ticks.push(world.execution.tick);
        }),
        { name: "updateTick" }
      );
      addSystem(
        world,
        defineSystem("shutdownTick", () => {
          ticks.push(world.execution.tick);
        }),
        { name: "shutdownTick", schedule: Shutdown }
      );
      await runOnce(world);
      await runOnce(world);
      await stop(world);
      assert.deepStrictEqual(ticks, [1, 1, 1, 2, 2, 2]);
      assert.strictEqual(world.execution.tick, 2);
    });

    it("retains empty and failed attempts and guards the maximum tick", async () => {
      const empty = createWorld();
      await runOnce(empty);
      assert.strictEqual(empty.execution.tick, 1);

      const failed = createWorld();
      addSystem(
        failed,
        defineSystem("failure", () => {
          throw new Error("failed attempt");
        }),
        { name: "failure" }
      );
      await assert.rejects(runOnce(failed));
      assert.strictEqual(failed.execution.tick, 1);

      empty.execution.tick = Number.MAX_SAFE_INTEGER;
      await assert.rejects(runOnce(empty), IrisLimitExceeded);
      assert.strictEqual(empty.execution.tick, Number.MAX_SAFE_INTEGER);
    });

    it("startup runs once before first frame", async () => {
      const world = createWorld();
      let startupCount = 0;
      let updateCount = 0;

      addSystem(
        world,
        defineSystem("startupSys", function startupSys() {
          startupCount++;
        }),
        { schedule: Startup }
      );
      addSystem(
        world,
        defineSystem("updateSys", function updateSys() {
          updateCount++;
        })
      );

      await runOnce(world);
      await runOnce(world);
      await runOnce(world);

      assert.strictEqual(startupCount, 1);
      assert.strictEqual(updateCount, 3);
    });

    it("shutdown does not run again on second stop", async () => {
      const world = createWorld();
      let shutdownCount = 0;

      addSystem(
        world,
        defineSystem("shutdownSys", function shutdownSys() {
          shutdownCount++;
        }),
        { schedule: Shutdown }
      );

      await runOnce(world);
      await stop(world);
      await stop(world);

      assert.strictEqual(shutdownCount, 1);
    });

    it("stop then runOnce re-triggers startup and shutdown", async () => {
      const world = createWorld();
      let startupCount = 0;
      let shutdownCount = 0;

      addSystem(
        world,
        defineSystem("startupSys", function startupSys() {
          startupCount++;
        }),
        { schedule: Startup }
      );
      addSystem(
        world,
        defineSystem("shutdownSys", function shutdownSys() {
          shutdownCount++;
        }),
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

    it("stop during restarted Startup waits and runs Shutdown", async () => {
      const world = createWorld();
      let startupStarted!: () => void;
      let releaseStartup!: () => void;
      const startupStart = new Promise<void>((resolve) => {
        startupStarted = resolve;
      });
      const startupGate = new Promise<void>((resolve) => {
        releaseStartup = resolve;
      });
      let startupCount = 0;
      let shutdownCount = 0;
      addSystem(
        world,
        defineSystem("startupSys", async function startupSys() {
          startupCount++;
          if (startupCount === 2) {
            startupStarted();
            await startupGate;
          }
        }),
        { schedule: Startup }
      );
      addSystem(
        world,
        defineSystem("shutdownSys", function shutdownSys() {
          shutdownCount++;
        }),
        { schedule: Shutdown }
      );

      await runOnce(world);
      await stop(world);

      const frame = runOnce(world);
      await startupStart;
      const stopping = stop(world);
      assert.strictEqual(shutdownCount, 1);

      releaseStartup();
      await Promise.all([frame, stopping]);
      assert.strictEqual(shutdownCount, 2);
    });

    it("stop from a sync system runs Shutdown after the frame completes", async () => {
      const world = createWorld();
      const order: string[] = [];
      addSystem(
        world,
        defineSystem("updateSys", function updateSys() {
          order.push("update");
          stop(world);
        })
      );
      addSystem(
        world,
        defineSystem("lastSys", function lastSys() {
          order.push("last");
        }),
        { schedule: Last }
      );
      addSystem(
        world,
        defineSystem("shutdownSys", function shutdownSys() {
          order.push("shutdown");
        }),
        { schedule: Shutdown }
      );

      await runOnce(world);
      await stop(world);

      assert.deepStrictEqual(order, ["update", "last", "shutdown"]);
    });

    it("stop without prior runOnce runs a shutdown system", async () => {
      const world = createWorld();
      let shutdownCount = 0;

      addSystem(
        world,
        defineSystem("shutdownSys", () => {
          shutdownCount++;
        }),
        { schedule: Shutdown }
      );

      assert.strictEqual(shutdownCount, 0);
      assert.strictEqual(world.execution.tick, 0);
      await stop(world);

      assert.strictEqual(shutdownCount, 1);
      assert.strictEqual(world.execution.tick, 0);
    });

    it("waits for a manual frame before shutdown", async () => {
      const world = createWorld();
      let started!: () => void;
      let release!: () => void;
      const start = new Promise<void>((resolve) => {
        started = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const calls: string[] = [];
      addSystem(
        world,
        defineSystem("updateSys", async function updateSys() {
          calls.push("update-start");
          started();
          await gate;
          calls.push("update-end");
        })
      );
      addSystem(
        world,
        defineSystem("shutdownSys", function shutdownSys() {
          calls.push("shutdown");
        }),
        { schedule: Shutdown }
      );

      const frame = runOnce(world);
      await start;
      const stopping = stop(world);
      assert.deepStrictEqual(calls, ["update-start"]);

      release();
      await Promise.all([frame, stopping]);
      assert.deepStrictEqual(calls, ["update-start", "update-end", "shutdown"]);
    });

    it("rejects manual frames during shutdown", async () => {
      const world = createWorld();
      let started!: () => void;
      let release!: () => void;
      const start = new Promise<void>((resolve) => {
        started = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      addSystem(
        world,
        defineSystem("shutdownSys", async function shutdownSys() {
          started();
          await gate;
        }),
        { schedule: Shutdown }
      );

      const stopping = stop(world);
      await start;

      await assert.rejects(runOnce(world), IrisInvalidState);
      assert.strictEqual(world.execution.tick, 0);

      release();
      await stopping;
    });

    it("waits for the active frame before shutdown", async () => {
      const animationFrame = mockAnimationFrame();
      let updateStarted!: () => void;
      let releaseUpdate!: () => void;
      let shutdownStarted!: () => void;
      let releaseShutdown!: () => void;
      const updateStart = new Promise<void>((resolve) => {
        updateStarted = resolve;
      });
      const updateGate = new Promise<void>((resolve) => {
        releaseUpdate = resolve;
      });
      const shutdownStart = new Promise<void>((resolve) => {
        shutdownStarted = resolve;
      });
      const shutdownGate = new Promise<void>((resolve) => {
        releaseShutdown = resolve;
      });

      try {
        const world = createWorld();
        const calls: string[] = [];
        addSystem(
          world,
          defineSystem("updateSys", async function updateSys() {
            calls.push("update-start");
            updateStarted();
            await updateGate;
            calls.push("update-end");
          })
        );
        addSystem(
          world,
          defineSystem("shutdownSys", async function shutdownSys() {
            calls.push("shutdown-start");
            shutdownStarted();
            await shutdownGate;
            calls.push("shutdown-end");
          }),
          { schedule: Shutdown }
        );

        run(world);
        const frame = animationFrame.runFrame();
        await updateStart;

        const firstStop = stop(world);
        const secondStop = stop(world);
        assert.deepStrictEqual(calls, ["update-start"]);

        releaseUpdate();
        await shutdownStart;
        const thirdStop = stop(world);
        assert.deepStrictEqual(calls, ["update-start", "update-end", "shutdown-start"]);

        releaseShutdown();
        await Promise.all([frame, firstStop, secondStop, thirdStop]);
        assert.deepStrictEqual(calls, ["update-start", "update-end", "shutdown-start", "shutdown-end"]);
      } finally {
        releaseUpdate();
        releaseShutdown();
        animationFrame.restore();
      }
    });

    it("runs shutdown after an active frame rejects", async () => {
      const animationFrame = mockAnimationFrame();

      try {
        const world = createWorld();
        const error = new Error("frame failed");
        let shutdownCount = 0;
        addSystem(
          world,
          defineSystem("updateSys", function updateSys() {
            throw error;
          })
        );
        addSystem(
          world,
          defineSystem("shutdownSys", function shutdownSys() {
            shutdownCount++;
          }),
          { schedule: Shutdown }
        );

        run(world);
        const frame = animationFrame.runFrame();
        const stopping = stop(world);

        await Promise.all([
          assert.rejects(frame, (actual) => actual === error),
          assert.rejects(stopping, (actual) => actual === error),
        ]);
        assert.strictEqual(shutdownCount, 1);
        await stop(world);
        assert.strictEqual(shutdownCount, 1);
      } finally {
        animationFrame.restore();
      }
    });

    it("rejects with both errors when frame and shutdown both fail", async () => {
      const animationFrame = mockAnimationFrame();

      try {
        const world = createWorld();
        const frameError = new Error("frame failed");
        const shutdownError = new Error("shutdown failed");
        addSystem(
          world,
          defineSystem("updateSys", function updateSys() {
            throw frameError;
          })
        );
        addSystem(
          world,
          defineSystem("shutdownSys", function shutdownSys() {
            throw shutdownError;
          }),
          { schedule: Shutdown }
        );

        run(world);
        const frame = animationFrame.runFrame();
        const stopping = stop(world);

        await Promise.all([
          assert.rejects(frame, (actual) => actual === frameError),
          assert.rejects(
            stopping,
            (actual: unknown) =>
              actual instanceof AggregateError && actual.errors[0] === frameError && actual.errors[1] === shutdownError
          ),
        ]);
      } finally {
        animationFrame.restore();
      }
    });

    it("ignores run() while a shutdown is in progress", async () => {
      const animationFrame = mockAnimationFrame();

      try {
        const world = createWorld();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });

        addSystem(
          world,
          defineSystem("shutdownSys", async function shutdownSys() {
            await gate;
          }),
          { schedule: Shutdown }
        );

        const stopping = stop(world);

        run(world);
        assert.strictEqual(animationFrame.hasFrame(), false);

        release();
        await stopping;
      } finally {
        animationFrame.restore();
      }
    });

    it("retains a failed shutdown without retrying it", async () => {
      const world = createWorld();
      const error = new Error("shutdown failed");
      let attempts = 0;
      addSystem(
        world,
        defineSystem("shutdownSys", function shutdownSys() {
          attempts++;
          throw error;
        }),
        { schedule: Shutdown }
      );

      const firstStop = stop(world);
      const secondStop = stop(world);
      assert.strictEqual(secondStop, firstStop);

      await Promise.all([
        assert.rejects(firstStop, (actual) => actual === error),
        assert.rejects(secondStop, (actual) => actual === error),
      ]);
      assert.strictEqual(attempts, 1);

      const thirdStop = stop(world);
      assert.strictEqual(thirdStop, firstStop);
      await assert.rejects(thirdStop, (actual) => actual === error);
      assert.strictEqual(attempts, 1);
    });
  });

  describe("Auto-rebuild", () => {
    it("rebuilds pipeline when dirty", async () => {
      const world = createWorld();
      const calls: string[] = [];

      addSystem(
        world,
        defineSystem("first", function first() {
          calls.push("first");
        })
      );

      await runOnce(world);
      assert.deepStrictEqual(calls, ["first"]);

      // Add new system after first run
      addSystem(
        world,
        defineSystem("second", function second() {
          calls.push("second");
        })
      );

      calls.length = 0;
      await runOnce(world);

      assert.deepStrictEqual(calls, ["first", "second"]);
    });

    it("rebuild includes newly inserted schedule", async () => {
      const world = createWorld();
      const calls: string[] = [];

      addSystem(
        world,
        defineSystem("updateSys", function updateSys() {
          calls.push("update");
        })
      );

      await runOnce(world);
      assert.deepStrictEqual(calls, ["update"]);

      // Insert custom schedule and add a system to it
      const Physics = defineSchedule("Physics");
      insertScheduleBefore(world, Physics, Update);
      addSystem(
        world,
        defineSystem("physicsSys", function physicsSys() {
          calls.push("physics");
        }),
        { schedule: Physics }
      );

      calls.length = 0;
      await runOnce(world);

      assert.deepStrictEqual(calls, ["physics", "update"]);
    });
  });

  describe("defineSystem", () => {
    it("runs a direct tick with the current world", async () => {
      const world = createWorld();
      let received: typeof world | undefined;
      const system = defineSystem("direct", (systemWorld) => {
        received = systemWorld;
      });

      addSystem(world, system);
      await runOnce(world);

      assert.strictEqual(received, world);
    });

    it("rejects empty names", () => {
      assert.throws(() => defineSystem("", () => {}), IrisInvalidSystemName);
    });

    it("retains direct closure state after reset", async () => {
      const world = createWorld();
      const values: number[] = [];
      let count = 0;
      const counter = defineSystem("counter", () => {
        values.push(++count);
      });

      addSystem(world, counter);
      await runOnce(world);
      await runOnce(world);
      resetWorld(world);
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

      addSystem(
        world,
        defineSystem("noop", function noop() {})
      );

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

      addSystem(
        world,
        defineSystem("noop", function noop() {})
      );

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

      addSystem(
        world,
        defineSystem("alpha", function alpha() {})
      );
      addSystem(
        world,
        defineSystem("beta", function beta() {})
      );

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

      addSystem(
        world,
        defineSystem("work", function work() {
          // Burn a tiny amount of time
          let sum = 0;
          for (let i = 0; i < 1000; i++) sum += i;
          void sum;
        })
      );

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

      addSystem(
        world,
        defineSystem("mySystem", function mySystem() {
          log.push("run:mySystem");
        })
      );

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

      addSystem(
        world,
        defineSystem("asyncWork", async function asyncWork() {
          await new Promise((resolve) => setTimeout(resolve, 10));
        })
      );

      await runOnce(world);

      // Duration should include the 10ms+ await
      assert.strictEqual(capturedDuration >= 5, true);
    });
  });

  describe("System Sets", () => {
    describe("defineSystemSet", () => {
      it("returns a branded string label", () => {
        const PhysicsSet = defineSystemSet("PhysicsSet");
        assert.strictEqual(PhysicsSet, "PhysicsSet");
      });
    });

    describe("addSystemSet", () => {
      it("registers a system set in the world", () => {
        const world = createWorld();
        const PhysicsSet = defineSystemSet("PhysicsSet");
        addSystemSet(world, PhysicsSet);
        assert.strictEqual(world.systemSets.byId.has(PhysicsSet), true);
      });

      it("defaults schedule to Update", () => {
        const world = createWorld();
        const PhysicsSet = defineSystemSet("PhysicsSet");
        addSystemSet(world, PhysicsSet);
        assert.strictEqual(world.systemSets.byId.get(PhysicsSet)?.schedule, Update);
      });

      it("accepts explicit schedule", () => {
        const world = createWorld();
        const PhysicsSet = defineSystemSet("PhysicsSet");
        addSystemSet(world, PhysicsSet, { schedule: PostUpdate });
        assert.strictEqual(world.systemSets.byId.get(PhysicsSet)?.schedule, PostUpdate);
      });

      it("throws IrisDuplicate for duplicate set label", () => {
        const world = createWorld();
        const PhysicsSet = defineSystemSet("PhysicsSet");
        addSystemSet(world, PhysicsSet);
        assert.throws(() => addSystemSet(world, PhysicsSet), IrisDuplicate);
      });

      it("throws IrisDuplicate when set label matches a system name", () => {
        const world = createWorld();
        addSystem(
          world,
          defineSystem("shared", function shared() {}),
          { schedule: PostUpdate }
        );
        const Shared = defineSystemSet("shared");

        assert.throws(
          () => addSystemSet(world, Shared),
          (error: unknown) => error instanceof IrisDuplicate && error.resource === "System" && error.id === "shared"
        );
        assert.strictEqual(world.systemSets.byId.has(Shared), false);
      });

      it("marks schedules dirty", () => {
        const world = createWorld();
        world.schedules.dirty = false;
        const PhysicsSet = defineSystemSet("PhysicsSet");
        addSystemSet(world, PhysicsSet);
        assert.strictEqual(world.schedules.dirty, true);
      });
    });

    describe("addSystem with set", () => {
      it("associates system with a set", () => {
        const world = createWorld();
        const PhysicsSet = defineSystemSet("PhysicsSet");
        addSystemSet(world, PhysicsSet);

        const sys = defineSystem("sys", () => {});
        addSystem(world, sys, { set: PhysicsSet });

        assert.strictEqual(world.systems.byId.get("sys")?.set, PhysicsSet);
        assert.deepStrictEqual(world.systemSets.byId.get(PhysicsSet)?.systems, ["sys"]);
      });

      it("inherits schedule from set", () => {
        const world = createWorld();
        const PhysicsSet = defineSystemSet("PhysicsSet");
        addSystemSet(world, PhysicsSet, { schedule: PostUpdate });

        const sys = defineSystem("sys", () => {});
        addSystem(world, sys, { set: PhysicsSet });

        assert.strictEqual(world.systems.byId.get("sys")?.schedule, PostUpdate);
      });

      it("throws IrisNotFound when set is not registered", () => {
        const world = createWorld();
        const PhysicsSet = defineSystemSet("PhysicsSet");

        const sys = defineSystem("sys", () => {});
        assert.throws(() => addSystem(world, sys, { set: PhysicsSet }), IrisNotFound);
      });
    });

    describe("set ordering", () => {
      it("set before set orders all members", async () => {
        const world = createWorld();
        const calls: string[] = [];

        const PhysicsSet = defineSystemSet("PhysicsSet");
        const RenderSet = defineSystemSet("RenderSet");
        addSystemSet(world, PhysicsSet, { before: RenderSet });
        addSystemSet(world, RenderSet);

        addSystem(
          world,
          defineSystem("p1", () => {
            calls.push("p1");
          }),
          { set: PhysicsSet }
        );
        addSystem(
          world,
          defineSystem("p2", () => {
            calls.push("p2");
          }),
          { set: PhysicsSet }
        );
        addSystem(
          world,
          defineSystem("r1", () => {
            calls.push("r1");
          }),
          { set: RenderSet }
        );
        addSystem(
          world,
          defineSystem("r2", () => {
            calls.push("r2");
          }),
          { set: RenderSet }
        );

        await runOnce(world);

        assert.strictEqual(calls.indexOf("p1") < calls.indexOf("r1"), true);
        assert.strictEqual(calls.indexOf("p1") < calls.indexOf("r2"), true);
        assert.strictEqual(calls.indexOf("p2") < calls.indexOf("r1"), true);
        assert.strictEqual(calls.indexOf("p2") < calls.indexOf("r2"), true);
      });

      it("set after set orders all members", async () => {
        const world = createWorld();
        const calls: string[] = [];

        const PhysicsSet = defineSystemSet("PhysicsSet");
        const RenderSet = defineSystemSet("RenderSet");
        addSystemSet(world, PhysicsSet);
        addSystemSet(world, RenderSet, { after: PhysicsSet });

        addSystem(
          world,
          defineSystem("p1", () => {
            calls.push("p1");
          }),
          { set: PhysicsSet }
        );
        addSystem(
          world,
          defineSystem("p2", () => {
            calls.push("p2");
          }),
          { set: PhysicsSet }
        );
        addSystem(
          world,
          defineSystem("r1", () => {
            calls.push("r1");
          }),
          { set: RenderSet }
        );
        addSystem(
          world,
          defineSystem("r2", () => {
            calls.push("r2");
          }),
          { set: RenderSet }
        );

        await runOnce(world);

        assert.strictEqual(calls.indexOf("p1") < calls.indexOf("r1"), true);
        assert.strictEqual(calls.indexOf("p1") < calls.indexOf("r2"), true);
        assert.strictEqual(calls.indexOf("p2") < calls.indexOf("r1"), true);
        assert.strictEqual(calls.indexOf("p2") < calls.indexOf("r2"), true);
      });

      it("system before set orders system before all set members", async () => {
        const world = createWorld();
        const calls: string[] = [];

        const RenderSet = defineSystemSet("RenderSet");
        addSystemSet(world, RenderSet);

        const standalone = defineSystem("standalone", () => {
          calls.push("standalone");
        });
        addSystem(world, standalone, { before: RenderSet });

        addSystem(
          world,
          defineSystem("r1", () => {
            calls.push("r1");
          }),
          { set: RenderSet }
        );
        addSystem(
          world,
          defineSystem("r2", () => {
            calls.push("r2");
          }),
          { set: RenderSet }
        );

        await runOnce(world);

        assert.strictEqual(calls.indexOf("standalone") < calls.indexOf("r1"), true);
        assert.strictEqual(calls.indexOf("standalone") < calls.indexOf("r2"), true);
      });

      it("system after set orders system after all set members", async () => {
        const world = createWorld();
        const calls: string[] = [];

        const PhysicsSet = defineSystemSet("PhysicsSet");
        addSystemSet(world, PhysicsSet);

        addSystem(
          world,
          defineSystem("p1", () => {
            calls.push("p1");
          }),
          { set: PhysicsSet }
        );
        addSystem(
          world,
          defineSystem("p2", () => {
            calls.push("p2");
          }),
          { set: PhysicsSet }
        );

        const standalone = defineSystem("standalone", () => {
          calls.push("standalone");
        });
        addSystem(world, standalone, { after: PhysicsSet });

        await runOnce(world);

        assert.strictEqual(calls.indexOf("p1") < calls.indexOf("standalone"), true);
        assert.strictEqual(calls.indexOf("p2") < calls.indexOf("standalone"), true);
      });

      it("set before system orders all set members before system", async () => {
        const world = createWorld();
        const calls: string[] = [];

        const standalone = defineSystem("standalone", () => {
          calls.push("standalone");
        });
        const PhysicsSet = defineSystemSet("PhysicsSet");
        addSystemSet(world, PhysicsSet, { before: standalone });

        addSystem(
          world,
          defineSystem("p1", () => {
            calls.push("p1");
          }),
          { set: PhysicsSet }
        );
        addSystem(world, standalone);

        await runOnce(world);

        assert.strictEqual(calls.indexOf("p1") < calls.indexOf("standalone"), true);
      });

      it("set after system orders all set members after system", async () => {
        const world = createWorld();
        const calls: string[] = [];

        const standalone = defineSystem("standalone", () => {
          calls.push("standalone");
        });
        const PhysicsSet = defineSystemSet("PhysicsSet");
        addSystemSet(world, PhysicsSet, { after: standalone });

        addSystem(world, standalone);
        addSystem(
          world,
          defineSystem("p1", () => {
            calls.push("p1");
          }),
          { set: PhysicsSet }
        );

        await runOnce(world);

        assert.strictEqual(calls.indexOf("standalone") < calls.indexOf("p1"), true);
      });

      it("in-set system referenced directly (not set-promotion)", async () => {
        const world = createWorld();
        const calls: string[] = [];

        const PhysicsSet = defineSystemSet("PhysicsSet");
        addSystemSet(world, PhysicsSet);

        const p1 = defineSystem("p1", () => {
          calls.push("p1");
        });
        const p2 = defineSystem("p2", () => {
          calls.push("p2");
        });
        addSystem(world, p1, { set: PhysicsSet });
        addSystem(world, p2, { set: PhysicsSet });

        const standalone = defineSystem("standalone", () => {
          calls.push("standalone");
        });
        addSystem(world, standalone, { after: p1 });

        await runOnce(world);

        assert.strictEqual(calls.indexOf("p1") < calls.indexOf("standalone"), true);
      });

      it("empty set is valid and transparent", async () => {
        const world = createWorld();
        const calls: string[] = [];

        const EmptySet = defineSystemSet("EmptySet");
        addSystemSet(world, EmptySet);

        const standalone = defineSystem("standalone", () => {
          calls.push("standalone");
        });
        addSystem(world, standalone, { after: EmptySet });

        await runOnce(world);

        assert.deepStrictEqual(calls, ["standalone"]);
      });

      it("empty set wires predecessors to successors", async () => {
        const world = createWorld();
        const calls: string[] = [];

        const EmptySet = defineSystemSet("EmptySet");
        addSystemSet(world, EmptySet);

        const a = defineSystem("a", () => {
          calls.push("a");
        });
        const b = defineSystem("b", () => {
          calls.push("b");
        });

        addSystem(world, b, { after: EmptySet });
        addSystem(world, a, { before: EmptySet });

        await runOnce(world);

        assert.strictEqual(calls.indexOf("a") < calls.indexOf("b"), true);
      });

      it("systems within a set respect their own constraints", async () => {
        const world = createWorld();
        const calls: string[] = [];

        const PhysicsSet = defineSystemSet("PhysicsSet");
        addSystemSet(world, PhysicsSet);

        const detect = defineSystem("detect", () => {
          calls.push("detect");
        });
        const resolve = defineSystem("resolve", () => {
          calls.push("resolve");
        });
        const apply = defineSystem("apply", () => {
          calls.push("apply");
        });

        addSystem(world, resolve, { set: PhysicsSet, after: detect });
        addSystem(world, detect, { set: PhysicsSet, after: apply });
        addSystem(world, apply, { set: PhysicsSet });

        await runOnce(world);

        assert.deepStrictEqual(calls, ["apply", "detect", "resolve"]);
      });

      it("circular dependency through sets throws IrisInvalidState", async () => {
        const world = createWorld();

        const SetA = defineSystemSet("SetA");
        const SetB = defineSystemSet("SetB");
        addSystemSet(world, SetA, { before: SetB });
        addSystemSet(world, SetB, { before: SetA });

        addSystem(
          world,
          defineSystem("a", () => {}),
          { set: SetA }
        );
        addSystem(
          world,
          defineSystem("b", () => {}),
          { set: SetB }
        );

        await assert.rejects(runOnce(world), (err) => err instanceof IrisInvalidState);
      });

      it("unknown set in before throws IrisNotFound", async () => {
        const world = createWorld();
        const UnknownSet = defineSystemSet("UnknownSet");

        addSystem(
          world,
          defineSystem("sys", function sys() {}),
          { before: UnknownSet }
        );

        await assert.rejects(runOnce(world), (err) => err instanceof IrisNotFound);
      });

      it("unknown set in after throws IrisNotFound", async () => {
        const world = createWorld();
        const UnknownSet = defineSystemSet("UnknownSet");

        addSystem(
          world,
          defineSystem("sys", function sys() {}),
          { after: UnknownSet }
        );

        await assert.rejects(runOnce(world), (err) => err instanceof IrisNotFound);
      });

      it("set referencing unknown target in before throws IrisNotFound", async () => {
        const world = createWorld();
        const PhysicsSet = defineSystemSet("PhysicsSet");
        addSystemSet(world, PhysicsSet, { before: "nonexistent" });

        addSystem(
          world,
          defineSystem("p1", () => {}),
          { set: PhysicsSet }
        );

        await assert.rejects(runOnce(world), (err) => err instanceof IrisNotFound);
      });

      it("set referencing unknown target in after throws IrisNotFound", async () => {
        const world = createWorld();
        const PhysicsSet = defineSystemSet("PhysicsSet");
        addSystemSet(world, PhysicsSet, { after: "nonexistent" });

        addSystem(
          world,
          defineSystem("p1", () => {}),
          { set: PhysicsSet }
        );

        await assert.rejects(runOnce(world), (err) => err instanceof IrisNotFound);
      });

      it("mixed standalone and set systems order correctly", async () => {
        const world = createWorld();
        const calls: string[] = [];

        const PhysicsSet = defineSystemSet("PhysicsSet");
        addSystemSet(world, PhysicsSet);

        addSystem(
          world,
          defineSystem("input", function input() {
            calls.push("input");
          })
        );
        addSystem(
          world,
          defineSystem("gravity", () => {
            calls.push("gravity");
          }),
          { set: PhysicsSet }
        );
        addSystem(
          world,
          defineSystem("collision", () => {
            calls.push("collision");
          }),
          { set: PhysicsSet }
        );
        addSystem(
          world,
          defineSystem("render", function render() {
            calls.push("render");
          }),
          { after: PhysicsSet }
        );

        await runOnce(world);

        assert.strictEqual(calls.indexOf("gravity") < calls.indexOf("render"), true);
        assert.strictEqual(calls.indexOf("collision") < calls.indexOf("render"), true);
      });
    });
  });

  describe("Conditions", () => {
    it("checks system and set conditions at their first point of use", async () => {
      const world = createWorld();
      const Group = defineSystemSet("Group");
      const calls: string[] = [];
      const condition = (name: string) =>
        defineCondition(name, () => {
          calls.push(name);
          return true;
        });

      addSystemSet(world, Group, { condition: condition("set condition") });
      addSystem(
        world,
        defineSystem("first", () => {
          calls.push("first system");
        }),
        {
          set: Group,
          condition: condition("first condition"),
        }
      );
      addSystem(
        world,
        defineSystem("second", () => {
          calls.push("second system");
        }),
        {
          condition: condition("second condition"),
        }
      );

      await runOnce(world);

      assert.deepStrictEqual(calls, [
        "set condition",
        "first condition",
        "first system",
        "second condition",
        "second system",
      ]);
    });

    it("evaluates a system condition on every invocation and skips false ticks", async () => {
      const world = createWorld();
      let checks = 0;
      let runs = 0;
      const alternating = defineCondition("alternating", () => ++checks % 2 === 0);

      addSystem(
        world,
        defineSystem("conditioned", () => {
          runs++;
        }),
        { name: "conditioned", condition: alternating }
      );

      await runOnce(world);
      await runOnce(world);
      await runOnce(world);

      assert.deepStrictEqual({ checks, runs }, { checks: 3, runs: 1 });
    });

    it("caches set true and false results across non-contiguous members", async () => {
      const world = createWorld();
      const Group = defineSystemSet("Group");
      let checks = 0;
      const calls: string[] = [];
      const alternating = defineCondition("alternatingSet", () => ++checks % 2 === 1);
      addSystemSet(world, Group, { condition: alternating });
      addSystem(
        world,
        defineSystem("first", () => {
          calls.push("first");
        }),
        { name: "first", set: Group }
      );
      addSystem(
        world,
        defineSystem("middle", () => {
          calls.push("middle");
        }),
        { name: "middle" }
      );
      addSystem(
        world,
        defineSystem("last", () => {
          calls.push("last");
        }),
        { name: "last", set: Group }
      );

      await runOnce(world);
      await runOnce(world);

      assert.strictEqual(checks, 2);
      assert.deepStrictEqual(calls, ["first", "middle", "last", "middle"]);
    });

    it("does not evaluate member conditions when the set condition is false", async () => {
      const world = createWorld();
      const Group = defineSystemSet("Group");
      let memberChecks = 0;
      addSystemSet(world, Group, { condition: defineCondition("setFalse", () => false) });
      addSystem(
        world,
        defineSystem("member", () => assert.fail("system ran")),
        {
          name: "member",
          set: Group,
          condition: defineCondition("member", () => {
            memberChecks++;
            return true;
          }),
        }
      );

      await runOnce(world);

      assert.strictEqual(memberChecks, 0);
    });

    it("shares one condition result across systems and sets by definition identity", async () => {
      const world = createWorld();
      const Group = defineSystemSet("Group");
      let checks = 0;
      let runs = 0;
      const alternating = defineCondition("sharedAlternating", () => ++checks % 2 === 1);
      addSystemSet(world, Group, { condition: alternating });
      addSystem(
        world,
        defineSystem("one", () => {
          runs++;
        }),
        { name: "one", set: Group, condition: alternating }
      );
      addSystem(
        world,
        defineSystem("two", () => {
          runs++;
        }),
        { name: "two", condition: alternating }
      );

      await runOnce(world);
      await runOnce(world);
      await runOnce(world);

      assert.deepStrictEqual({ checks, runs }, { checks: 3, runs: 4 });
    });

    it("evaluates a reused definition independently in different schedules", async () => {
      const world = createWorld();
      let checks = 0;
      const shared = defineCondition("crossSchedule", () => {
        checks++;
        return true;
      });

      addSystem(
        world,
        defineSystem("first", () => {}),
        { schedule: First, condition: shared }
      );
      addSystem(
        world,
        defineSystem("last", () => {}),
        { schedule: Last, condition: shared }
      );

      await runOnce(world);

      assert.strictEqual(checks, 2);
    });

    it("keeps conditions outside system context and preserves instrumentation cleanup on errors", async () => {
      const world = createWorld();
      const events: string[] = [];
      registerObserverCallback(world, "scheduleStarted", () => events.push("scheduleStarted"));
      registerObserverCallback(world, "scheduleFinished", () => events.push("scheduleFinished"));
      registerObserverCallback(world, "systemStarted", () => events.push("systemStarted"));
      addSystem(
        world,
        defineSystem("throws", () => assert.fail("system ran")),
        {
          name: "throws",
          condition: defineCondition("throws", (conditionWorld) => {
            assert.strictEqual(conditionWorld.execution.systemId, null);
            throw new Error("condition failed");
          }),
        }
      );

      await assert.rejects(runOnce(world), /condition failed/);

      assert.deepStrictEqual(events, ["scheduleStarted", "scheduleFinished"]);
      assert.strictEqual(world.execution.scheduleLabel, null);
      assert.strictEqual(world.execution.systemId, null);
    });

    it("emits schedule events but no system events when a condition is false", async () => {
      const world = createWorld();
      const events: string[] = [];
      registerObserverCallback(world, "scheduleStarted", () => events.push("scheduleStarted"));
      registerObserverCallback(world, "scheduleFinished", () => events.push("scheduleFinished"));
      registerObserverCallback(world, "systemStarted", () => events.push("systemStarted"));
      registerObserverCallback(world, "systemFinished", () => events.push("systemFinished"));
      addSystem(
        world,
        defineSystem("skipped", () => assert.fail("system ran")),
        {
          name: "skipped",
          condition: defineCondition("false", () => false),
        }
      );

      await runOnce(world);

      assert.deepStrictEqual(events, ["scheduleStarted", "scheduleFinished"]);
    });

    it("consumes false Startup and Shutdown conditions", async () => {
      const world = createWorld();
      let startupChecks = 0;
      let shutdownChecks = 0;
      addSystem(
        world,
        defineSystem("startup", () => assert.fail("startup ran")),
        {
          name: "startup",
          schedule: Startup,
          condition: defineCondition("startupFalse", () => {
            startupChecks++;
            return false;
          }),
        }
      );
      addSystem(
        world,
        defineSystem("shutdown", () => assert.fail("shutdown ran")),
        {
          name: "shutdown",
          schedule: Shutdown,
          condition: defineCondition("shutdownFalse", () => {
            shutdownChecks++;
            return false;
          }),
        }
      );

      await runOnce(world);
      await runOnce(world);
      await stop(world);
      await stop(world);

      assert.deepStrictEqual({ startupChecks, shutdownChecks }, { startupChecks: 1, shutdownChecks: 1 });

      const stoppedBeforeFrame = createWorld();
      let immediateShutdownChecks = 0;
      addSystem(
        stoppedBeforeFrame,
        defineSystem("immediateShutdown", () => assert.fail("shutdown ran")),
        {
          name: "immediateShutdown",
          schedule: Shutdown,
          condition: defineCondition("immediateShutdownFalse", () => {
            immediateShutdownChecks++;
            return false;
          }),
        }
      );

      await stop(stoppedBeforeFrame);

      assert.strictEqual(immediateShutdownChecks, 1);
    });

    it("does not evaluate an empty set condition", async () => {
      const world = createWorld();
      let checks = 0;
      const Empty = defineSystemSet("Empty");
      addSystemSet(world, Empty, {
        condition: defineCondition("empty", () => {
          checks++;
          return true;
        }),
      });
      addSystem(
        world,
        defineSystem("prepare", () => {}),
        { name: "prepare" }
      );

      await runOnce(world);

      assert.strictEqual(checks, 0);
    });
  });

  describe("Custom-Named System References", () => {
    it("custom-named system referenceable via string in before", async () => {
      const world = createWorld();
      const calls: string[] = [];

      const sys = defineSystem("sys", () => {
        calls.push("sys");
      });
      addSystem(world, sys, { name: "customName" });

      addSystem(
        world,
        defineSystem("leader", function leader() {
          calls.push("leader");
        }),
        { before: "customName" }
      );

      await runOnce(world);

      assert.strictEqual(calls.indexOf("leader") < calls.indexOf("sys"), true);
    });

    it("same system registered twice with different names executes twice", async () => {
      const world = createWorld();
      const calls: string[] = [];

      const sys = defineSystem("sys", () => {
        calls.push("sys");
      });
      addSystem(world, sys);
      addSystem(world, sys, { name: "sysCopy" });

      await runOnce(world);

      assert.strictEqual(calls.length, 2);
    });

    it("system reference resolves to the default name, not a custom registration", async () => {
      const world = createWorld();
      const calls: string[] = [];

      const sys = defineSystem("sys", () => {
        calls.push("sys");
      });
      addSystem(world, sys);
      addSystem(world, sys, { name: "sysCopy" });

      const follower = defineSystem("follower", () => {
        calls.push("follower");
      });
      addSystem(world, follower, { after: sys });

      await runOnce(world);

      assert.strictEqual(calls.indexOf("sys") < calls.indexOf("follower"), true);
    });

    it("custom-named system in a set works with set-level ordering", async () => {
      const world = createWorld();
      const calls: string[] = [];

      const PhysicsSet = defineSystemSet("PhysicsSet");
      addSystemSet(world, PhysicsSet);

      const sys = defineSystem("sys", () => {
        calls.push("sys");
      });
      addSystem(world, sys, { set: PhysicsSet, name: "customPhysics" });

      const follower = defineSystem("follower", () => {
        calls.push("follower");
      });
      addSystem(world, follower, { after: PhysicsSet });

      await runOnce(world);

      assert.strictEqual(calls.indexOf("sys") < calls.indexOf("follower"), true);
    });
  });
});
