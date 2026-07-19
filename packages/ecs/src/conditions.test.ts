import assert from "node:assert";
import { describe, it } from "node:test";
import { every, once } from "./conditions.js";
import { IrisInvalidArgument } from "./error.js";
import { addSystem, addSystemSet, defineSystemSet, runOnce, Startup, stop } from "./scheduler.js";
import { createWorld, resetWorld } from "./world.js";

describe("Conditions", () => {
  it("once passes on the first tick and starts over after reset", async () => {
    const world = createWorld();
    let runs = 0;
    addSystem(
      world,
      () => {
        runs++;
      },
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

  it("every passes on divisible world ticks and restarts after reset", async () => {
    const world = createWorld();
    const runs: number[] = [];
    let tick = 0;
    addSystem(
      world,
      () => {
        runs.push(tick);
      },
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

  it("every aligns set and system intervals on shared world ticks", async () => {
    const world = createWorld();
    const Group = defineSystemSet("Group");
    const runs: string[] = [];
    let tick = 0;
    addSystemSet(world, Group, { condition: every(2) });
    addSystem(
      world,
      () => {
        runs.push(`first:${tick}`);
      },
      { name: "first", set: Group, condition: every(2) }
    );
    addSystem(
      world,
      () => {
        runs.push(`second:${tick}`);
      },
      { name: "second", set: Group, condition: every(3) }
    );
    addSystem(
      world,
      () => {
        runs.push(`standalone:${tick}`);
      },
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
      "first:2",
      "standalone:3",
      "first:4",
      "first:6",
      "second:6",
      "standalone:6",
      "first:9",
      "standalone:10",
      "first:11",
      "first:13",
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
      () => {
        onceRuns++;
      },
      { name: "once", condition: once() }
    );
    addSystem(
      world,
      () => {
        everyRuns++;
      },
      { name: "every", condition: every(3) }
    );

    await runOnce(world);
    addSystem(world, function addedLater() {});
    await runOnce(world);
    await runOnce(world);

    assert.deepStrictEqual({ onceRuns, everyRuns }, { onceRuns: 1, everyRuns: 1 });
  });

  it("preserves condition state across stop and restart", async () => {
    const world = createWorld();
    let runs = 0;
    addSystem(
      world,
      () => {
        runs++;
      },
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
