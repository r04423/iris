import assert from "node:assert";
import { describe, it } from "node:test";
import { every, once } from "./conditions.js";
import { IrisInvalidArgument } from "./error.js";
import {
  addSystem,
  addSystemSet,
  defineSystem,
  defineSystemSet,
  First,
  Last,
  runOnce,
  Startup,
  stop,
} from "./scheduler.js";
import { createWorld, resetWorld } from "./world.js";

describe("Conditions", () => {
  it("once passes on the first tick and starts over after reset", async () => {
    const world = createWorld();
    let runs = 0;
    addSystem(
      world,
      defineSystem("runOnce", () => {
        runs++;
      }),
      { name: "runOnce", condition: once() }
    );

    await runOnce(world);
    await runOnce(world);
    await runOnce(world);
    assert.strictEqual(runs, 1);

    resetWorld(world);
    await runOnce(world);
    assert.strictEqual(runs, 2);
  });

  it("every passes on every nth frame and restarts after reset", async () => {
    const world = createWorld();
    const runs: number[] = [];
    let tick = 0;
    addSystem(
      world,
      defineSystem("runEveryThirdTick", () => {
        runs.push(tick);
      }),
      { name: "runEveryThirdTick", condition: every(3) }
    );

    for (tick = 1; tick <= 7; tick++) {
      await runOnce(world);
    }
    assert.deepStrictEqual(runs, [3, 6]);

    resetWorld(world);

    for (tick = 8; tick <= 10; tick++) {
      await runOnce(world);
    }
    assert.deepStrictEqual(runs, [3, 6, 10]);
  });

  it("shares a built-in condition across attachments by definition identity", async () => {
    const world = createWorld();
    const shared = every(2);
    const runs: string[] = [];

    addSystem(
      world,
      defineSystem("firstShared", () => void runs.push("first")),
      { condition: shared }
    );
    addSystem(
      world,
      defineSystem("secondShared", () => void runs.push("second")),
      { condition: shared }
    );

    await runOnce(world);
    await runOnce(world);

    assert.deepStrictEqual(runs, ["first", "second"]);
  });

  it("creates independent built-in definitions on every call", async () => {
    const world = createWorld();
    let firstRuns = 0;
    let secondRuns = 0;

    addSystem(
      world,
      defineSystem("firstIndependent", () => void firstRuns++),
      { schedule: First, condition: once() }
    );
    addSystem(
      world,
      defineSystem("secondIndependent", () => void secondRuns++),
      { schedule: Last, condition: once() }
    );

    await runOnce(world);
    await runOnce(world);

    assert.deepStrictEqual({ firstRuns, secondRuns }, { firstRuns: 1, secondRuns: 1 });
  });

  it("isolates one built-in definition between worlds", async () => {
    const firstWorld = createWorld();
    const secondWorld = createWorld();
    const shared = once();
    let firstRuns = 0;
    let secondRuns = 0;

    addSystem(
      firstWorld,
      defineSystem("firstWorld", () => void firstRuns++),
      { condition: shared }
    );
    addSystem(
      secondWorld,
      defineSystem("secondWorld", () => void secondRuns++),
      { condition: shared }
    );

    await runOnce(firstWorld);
    await runOnce(secondWorld);
    await runOnce(firstWorld);
    await runOnce(secondWorld);

    assert.deepStrictEqual({ firstRuns, secondRuns }, { firstRuns: 1, secondRuns: 1 });
  });

  it("every counts its own evaluations, so nested intervals multiply", async () => {
    const world = createWorld();
    const Group = defineSystemSet("Group");
    const runs: string[] = [];
    let tick = 0;
    addSystemSet(world, Group, { condition: every(2) });
    addSystem(
      world,
      defineSystem("first", () => {
        runs.push(`first:${tick}`);
      }),
      { name: "first", set: Group, condition: every(2) }
    );
    addSystem(
      world,
      defineSystem("second", () => {
        runs.push(`second:${tick}`);
      }),
      { name: "second", set: Group, condition: every(3) }
    );
    addSystem(
      world,
      defineSystem("standalone", () => {
        runs.push(`standalone:${tick}`);
      }),
      { name: "standalone", condition: every(3) }
    );

    for (tick = 1; tick <= 7; tick++) {
      await runOnce(world);
    }

    resetWorld(world);

    for (tick = 8; tick <= 14; tick++) {
      await runOnce(world);
    }

    assert.deepStrictEqual(runs, [
      "standalone:3",
      "first:4",
      "second:6",
      "standalone:6",
      "standalone:10",
      "first:11",
      "second:13",
      "standalone:13",
    ]);
  });

  it("preserves condition state across dirty schedule rebuilds", async () => {
    const world = createWorld();
    let onceRuns = 0;
    let everyRuns = 0;
    addSystem(
      world,
      defineSystem("once", () => {
        onceRuns++;
      }),
      { name: "once", condition: once() }
    );
    addSystem(
      world,
      defineSystem("every", () => {
        everyRuns++;
      }),
      { name: "every", condition: every(3) }
    );

    await runOnce(world);
    addSystem(
      world,
      defineSystem("addedLater", function addedLater() {})
    );
    await runOnce(world);
    await runOnce(world);

    assert.deepStrictEqual({ onceRuns, everyRuns }, { onceRuns: 1, everyRuns: 1 });
  });

  it("preserves condition state across stop and restart", async () => {
    const world = createWorld();
    let runs = 0;
    addSystem(
      world,
      defineSystem("startupOnce", () => {
        runs++;
      }),
      { name: "startupOnce", schedule: Startup, condition: once() }
    );

    await runOnce(world);
    await stop(world);
    await runOnce(world);

    assert.strictEqual(runs, 1);
  });

  it("every rejects invalid tick intervals", () => {
    for (const ticks of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => every(ticks), IrisInvalidArgument);
    }
  });
});
