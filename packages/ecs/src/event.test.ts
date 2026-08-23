import assert from "node:assert";
import { describe, it } from "node:test";
import { IrisDuplicate, IrisInvalidArgument, IrisLimitExceeded } from "./error.js";
import {
  clearEvents,
  collectEvents,
  countEvents,
  defineEvent,
  emitEvent,
  hasEvents,
  readEvents,
  readLastEvent,
} from "./event.js";
import { addSystem, defineSystem, runOnce } from "./scheduler.js";
import { Type } from "./schema.js";
import { createWorld } from "./world.js";

describe("Event", () => {
  // ============================================================================
  // Event Definition Tests
  // ============================================================================

  describe("Event Definition", () => {
    it("defines tag event with no schema", () => {
      const GameStarted = defineEvent("GameStarted");

      assert.strictEqual(GameStarted.name, "GameStarted");
      assert.deepStrictEqual(GameStarted.schema, {});
      assert.strictEqual(typeof GameStarted.id, "number");
    });

    it("defines data event with schema", () => {
      const DamageDealt = defineEvent("DamageDealt", {
        schema: {
          target: Type.u32(),
          amount: Type.f32(),
        },
      });

      assert.strictEqual(DamageDealt.name, "DamageDealt");
      assert.ok(DamageDealt.schema.target);
      assert.ok(DamageDealt.schema.amount);
    });

    it("assigns unique IDs to events", () => {
      const Event1 = defineEvent("Event1");
      const Event2 = defineEvent("Event2");
      const Event3 = defineEvent("Event3");

      assert.notStrictEqual(Event1.id, Event2.id);
      assert.notStrictEqual(Event2.id, Event3.id);
      assert.notStrictEqual(Event1.id, Event3.id);
    });

    it("rejects a duplicate name without allocating an ID", () => {
      const First = defineEvent("SameName");

      assert.throws(
        () => defineEvent("SameName"),
        (error: unknown) => error instanceof IrisDuplicate && error.resource === "Event" && error.id === "SameName"
      );

      const Next = defineEvent("AfterDuplicateEvent");
      assert.strictEqual(Next.id, First.id + 1);
    });

    it("rejects an empty schema without registering an event", () => {
      const Previous = defineEvent("BeforeEmptyEventSchema");

      // @ts-expect-error -- testing runtime validation of an empty schema
      assert.throws(() => defineEvent("EmptyEventSchema", { schema: {} }), IrisInvalidArgument);

      const Next = defineEvent("EmptyEventSchema");
      assert.strictEqual(Next.id, Previous.id + 1);
    });
  });

  // ============================================================================
  // Event Emission Tests
  // ============================================================================

  describe("Event Emission", () => {
    it("emits tag event without data argument", async () => {
      const world = createWorld();
      const GameStarted = defineEvent("EmitTagEvent");
      let seen = false;

      addSystem(
        world,
        defineSystem("checker", function checker() {
          if (hasEvents(world, GameStarted)) seen = true;
        })
      );

      emitEvent(world, GameStarted);
      await runOnce(world);

      assert.strictEqual(seen, true);
    });

    it("emits data event with data argument", async () => {
      const world = createWorld();
      const DamageDealt = defineEvent("EmitDamageEvent", {
        schema: {
          target: Type.u32(),
          amount: Type.f32(),
        },
      });
      let seen = false;

      addSystem(
        world,
        defineSystem("checker", function checker() {
          if (hasEvents(world, DamageDealt)) seen = true;
        })
      );

      emitEvent(world, DamageDealt, { target: 1, amount: 25.5 });
      await runOnce(world);

      assert.strictEqual(seen, true);
    });
  });

  // ============================================================================
  // Event Read Tests
  // ============================================================================

  describe("Event Reading", () => {
    it("reads emitted events in system context", async () => {
      const world = createWorld();
      const Event = defineEvent("ReadBasic", {
        schema: {
          value: Type.i32<42>(),
        },
      });
      const results: 42[] = [];

      addSystem(
        world,
        defineSystem("reader", function reader() {
          readEvents(world, Event, (e) => {
            results.push(e.value);
          });
        })
      );

      emitEvent(world, Event, { value: 42 });
      await runOnce(world);

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0], 42);
    });

    it("reads multiple events in order", async () => {
      const world = createWorld();
      const Event = defineEvent("ReadMultiple", {
        schema: {
          value: Type.i32(),
        },
      });
      const results: number[] = [];

      addSystem(
        world,
        defineSystem("reader", function reader() {
          readEvents(world, Event, (e) => {
            results.push(e.value);
          });
        })
      );

      emitEvent(world, Event, { value: 1 });
      emitEvent(world, Event, { value: 2 });
      emitEvent(world, Event, { value: 3 });
      await runOnce(world);

      assert.strictEqual(results.length, 3);
      assert.deepStrictEqual(results, [1, 2, 3]);
    });

    it("marks events as read after read and second read sees nothing", async () => {
      const world = createWorld();
      const Event = defineEvent("ReadMarksRead");
      let firstCount = 0;
      let secondCount = 0;

      addSystem(
        world,
        defineSystem("reader", function reader() {
          // First read sees events
          readEvents(world, Event, () => {
            firstCount++;
          });
          // Second read without an intervening emission sees nothing
          readEvents(world, Event, () => {
            secondCount++;
          });
        })
      );

      emitEvent(world, Event);
      await runOnce(world);

      assert.strictEqual(firstCount, 1);
      assert.strictEqual(secondCount, 0);
    });

    it("reads tag events with undefined data", async () => {
      const world = createWorld();
      const TagEvent = defineEvent("ReadTag");
      const results: unknown[] = [];

      addSystem(
        world,
        defineSystem("reader", function reader() {
          readEvents(world, TagEvent, (e) => {
            results.push(e);
          });
        })
      );

      emitEvent(world, TagEvent);
      await runOnce(world);

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0], undefined);
    });
  });

  // ============================================================================
  // readLastEvent Tests
  // ============================================================================

  describe("readLastEvent", () => {
    it("returns undefined when no events in system context", async () => {
      const world = createWorld();
      const Event = defineEvent("LastEmpty");
      let result: unknown = "sentinel";

      addSystem(
        world,
        defineSystem("reader", function reader() {
          result = readLastEvent(world, Event);
        })
      );

      await runOnce(world);

      assert.strictEqual(result, undefined);
    });

    it("returns most recent event only", async () => {
      const world = createWorld();
      const Event = defineEvent("LastRecent", {
        schema: {
          value: Type.i32(),
        },
      });
      let result: { value: number } | undefined;

      addSystem(
        world,
        defineSystem("reader", function reader() {
          result = readLastEvent(world, Event);
        })
      );

      emitEvent(world, Event, { value: 1 });
      emitEvent(world, Event, { value: 2 });
      emitEvent(world, Event, { value: 3 });
      await runOnce(world);

      assert.strictEqual(result?.value, 3);
    });

    it("marks all events as read", async () => {
      const world = createWorld();
      const Event = defineEvent("LastMarksRead", {
        schema: {
          value: Type.i32(),
        },
      });
      let count = 0;

      addSystem(
        world,
        defineSystem("reader", function reader() {
          readLastEvent(world, Event);
          count = countEvents(world, Event);
        })
      );

      emitEvent(world, Event, { value: 1 });
      emitEvent(world, Event, { value: 2 });
      await runOnce(world);

      assert.strictEqual(count, 0);
    });
  });

  // ============================================================================
  // hasEvents and countEvents Tests
  // ============================================================================

  describe("hasEvents and countEvents", () => {
    it("hasEvents returns false when no events in system", async () => {
      const world = createWorld();
      const Event = defineEvent("HasEmpty");
      let result = true;

      addSystem(
        world,
        defineSystem("checker", function checker() {
          result = hasEvents(world, Event);
        })
      );

      await runOnce(world);

      assert.strictEqual(result, false);
    });

    it("hasEvents returns true when events exist in system", async () => {
      const world = createWorld();
      const Event = defineEvent("HasEvents");
      let result = false;

      addSystem(
        world,
        defineSystem("checker", function checker() {
          result = hasEvents(world, Event);
        })
      );

      emitEvent(world, Event);
      await runOnce(world);

      assert.strictEqual(result, true);
    });

    it("countEvents returns 0 when no events in system", async () => {
      const world = createWorld();
      const Event = defineEvent("CountEmpty");
      let result = -1;

      addSystem(
        world,
        defineSystem("counter", function counter() {
          result = countEvents(world, Event);
        })
      );

      await runOnce(world);

      assert.strictEqual(result, 0);
    });

    it("countEvents returns correct count in system", async () => {
      const world = createWorld();
      const Event = defineEvent("CountEvents");
      let result = 0;

      addSystem(
        world,
        defineSystem("counter", function counter() {
          result = countEvents(world, Event);
        })
      );

      emitEvent(world, Event);
      emitEvent(world, Event);
      emitEvent(world, Event);
      await runOnce(world);

      assert.strictEqual(result, 3);
    });

    it("hasEvents does not mark events as read", async () => {
      const world = createWorld();
      const Event = defineEvent("HasNoMark");
      let count = 0;

      addSystem(
        world,
        defineSystem("checker", function checker() {
          hasEvents(world, Event);
          hasEvents(world, Event);
          count = countEvents(world, Event);
        })
      );

      emitEvent(world, Event);
      await runOnce(world);

      assert.strictEqual(count, 1);
    });

    it("countEvents does not mark events as read", async () => {
      const world = createWorld();
      const Event = defineEvent("CountNoMark");
      let readCount = 0;

      addSystem(
        world,
        defineSystem("checker", function checker() {
          countEvents(world, Event);
          countEvents(world, Event);
          readEvents(world, Event, () => {
            readCount++;
          });
        })
      );

      emitEvent(world, Event);
      emitEvent(world, Event);
      await runOnce(world);

      assert.strictEqual(readCount, 2);
    });
  });

  // ============================================================================
  // clearEvents Tests
  // ============================================================================

  describe("clearEvents", () => {
    it("marks events as read without processing", async () => {
      const world = createWorld();
      const Event = defineEvent("ClearEvents", {
        schema: {
          value: Type.i32(),
        },
      });
      let count = 0;
      let has = true;

      addSystem(
        world,
        defineSystem("clearer", function clearer() {
          clearEvents(world, Event);
          count = countEvents(world, Event);
          has = hasEvents(world, Event);
        })
      );

      emitEvent(world, Event, { value: 1 });
      emitEvent(world, Event, { value: 2 });
      await runOnce(world);

      assert.strictEqual(count, 0);
      assert.strictEqual(has, false);
    });
  });

  // ============================================================================
  // Per-System Isolation Tests
  // ============================================================================

  describe("Per-System Isolation", () => {
    it("multiple systems see same events independently", async () => {
      const world = createWorld();
      const Event = defineEvent("IsolationTest", {
        schema: {
          value: Type.i32(),
        },
      });

      const system1Results: number[] = [];
      const system2Results: number[] = [];

      addSystem(
        world,
        defineSystem("system1", function system1() {
          readEvents(world, Event, (e) => {
            system1Results.push(e.value);
          });
        })
      );

      addSystem(
        world,
        defineSystem("system2", function system2() {
          readEvents(world, Event, (e) => {
            system2Results.push(e.value);
          });
        })
      );

      // Emit event before execution
      emitEvent(world, Event, { value: 42 });

      await runOnce(world);

      // Both systems should see the same event
      assert.deepStrictEqual(system1Results, [42]);
      assert.deepStrictEqual(system2Results, [42]);
    });
  });

  // ============================================================================
  // Same-System Multiple Calls Tests
  // ============================================================================

  describe("Same-System Multiple Calls", () => {
    it("events emitted during iteration are not visible in the same pass", async () => {
      const world = createWorld();
      const Event = defineEvent("EmitDuringIter", {
        schema: {
          value: Type.i32(),
        },
      });

      const emitterSeen: number[] = [];
      const readerSeen: number[] = [];

      // Emitter sees the original event but not the one it emits mid-iteration
      const emitter = defineSystem("emitter", (world) => {
        readEvents(world, Event, (e) => {
          emitterSeen.push(e.value);
          emitEvent(world, Event, { value: e.value + 10 });
        });
      });

      addSystem(world, emitter);

      // Reader (later system) sees the mid-iteration event on the same schedule
      addSystem(
        world,
        defineSystem("reader", function reader() {
          readEvents(world, Event, (e) => {
            readerSeen.push(e.value);
          });
        }),
        { after: [emitter] }
      );

      emitEvent(world, Event, { value: 1 });
      await runOnce(world);

      assert.deepStrictEqual(emitterSeen, [1]);
      assert.deepStrictEqual(readerSeen, [1, 11]);
    });

    it("nested reads see callback emissions deferred from the outer pass", async () => {
      const world = createWorld();
      const Event = defineEvent("NestedRevisionEvent", { schema: { value: Type.i32() } });
      const outer: number[] = [];
      const nested: number[] = [];
      let remaining: number[] | undefined;

      addSystem(
        world,
        defineSystem("reader", function reader() {
          readEvents(world, Event, (event) => {
            outer.push(event.value);
            emitEvent(world, Event, { value: 2 });
            readEvents(world, Event, (emitted) => nested.push(emitted.value));
          });
          remaining = collectEvents(world, Event).map((event) => event.value);
        })
      );

      emitEvent(world, Event, { value: 1 });
      await runOnce(world);

      assert.deepStrictEqual(outer, [1]);
      assert.deepStrictEqual(nested, [2]);
      assert.deepStrictEqual(remaining, []);
    });

    it("throwing read consumes its window", async () => {
      const world = createWorld();
      const Event = defineEvent("ThrowingReadEvent", { schema: { value: Type.i32() } });
      const afterThrow: number[] = [];
      const afterEmit: number[] = [];

      addSystem(
        world,
        defineSystem("reader", function reader() {
          assert.throws(() =>
            readEvents(world, Event, () => {
              throw new Error("event callback");
            })
          );
          readEvents(world, Event, (event) => afterThrow.push(event.value));
          emitEvent(world, Event, { value: 3 });
          readEvents(world, Event, (event) => afterEmit.push(event.value));
        })
      );

      emitEvent(world, Event, { value: 1 });
      await runOnce(world);

      assert.deepStrictEqual(afterThrow, []);
      assert.deepStrictEqual(afterEmit, [3]);
    });

    it("guards revision overflow without consuming events", async () => {
      const world = createWorld();
      const Event = defineEvent("EventRevisionOverflow");
      addSystem(
        world,
        defineSystem("reader", function reader() {
          const queue = world.events.byId.get(Event.id)!;
          const cursor = queue.lastRevision.get("reader");
          world.revision = Number.MAX_SAFE_INTEGER;
          assert.throws(() => readEvents(world, Event, () => {}), IrisLimitExceeded);
          assert.strictEqual(world.revision, Number.MAX_SAFE_INTEGER);
          assert.strictEqual(queue.lastRevision.get("reader"), cursor);
        })
      );
      emitEvent(world, Event);
      await runOnce(world);
    });
  });

  // ============================================================================
  // Outside System Context Tests
  // ============================================================================

  describe("Outside System Context", () => {
    it("all read functions return empty outside system context", () => {
      const world = createWorld();
      const Event = defineEvent("OutsideAll", { schema: { value: Type.i32() } });

      emitEvent(world, Event, { value: 42 });
      const revision = world.revision;

      // readEvents invokes nothing
      let readCount = 0;
      readEvents(world, Event, () => {
        readCount++;
      });
      assert.strictEqual(readCount, 0);
      // collectEvents returns empty
      assert.strictEqual(collectEvents(world, Event).length, 0);
      // hasEvents returns false
      assert.strictEqual(hasEvents(world, Event), false);
      // countEvents returns 0
      assert.strictEqual(countEvents(world, Event), 0);
      // readLastEvent returns undefined
      assert.strictEqual(readLastEvent(world, Event), undefined);
      // clearEvents is a no-op (should not throw)
      clearEvents(world, Event);
      assert.strictEqual(world.revision, revision);
    });

    it("emitEvent works outside system context", async () => {
      const world = createWorld();
      const Event = defineEvent("OutsideEmit", { schema: { value: Type.i32() } });
      let result: number | undefined;

      addSystem(
        world,
        defineSystem("reader", function reader() {
          const e = readLastEvent(world, Event);
          if (e) result = e.value;
        })
      );

      // Emit outside system, then read inside
      emitEvent(world, Event, { value: 99 });
      await runOnce(world);

      assert.strictEqual(result, 99);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("Edge Cases", () => {
    it("early exit marks events as read", async () => {
      const world = createWorld();
      const Event = defineEvent("EarlyExit", {
        schema: {
          value: Type.i32(),
        },
      });
      let secondReadCount = 0;

      addSystem(
        world,
        defineSystem("reader", function reader() {
          // Exit early after first event
          readEvents(world, Event, (e) => {
            if (e.value === 1) return false;
            return;
          });

          // The captured revision window is consumed despite early exit
          readEvents(world, Event, () => {
            secondReadCount++;
          });
        })
      );

      emitEvent(world, Event, { value: 1 });
      emitEvent(world, Event, { value: 2 });
      emitEvent(world, Event, { value: 3 });
      await runOnce(world);

      assert.strictEqual(secondReadCount, 0);
    });

    it("different event types are independent", async () => {
      const world = createWorld();
      const Event1 = defineEvent("Independent1");
      const Event2 = defineEvent("Independent2");
      let count1 = 0;
      let count2 = 0;
      let count1After = 0;
      let count2After = 0;

      addSystem(
        world,
        defineSystem("checker", function checker() {
          count1 = countEvents(world, Event1);
          count2 = countEvents(world, Event2);

          // Read Event1 only
          readEvents(world, Event1, () => {
            // consume
          });

          // Event2 should still be available
          count1After = countEvents(world, Event1);
          count2After = countEvents(world, Event2);
        })
      );

      emitEvent(world, Event1);
      emitEvent(world, Event2);
      emitEvent(world, Event2);
      await runOnce(world);

      assert.strictEqual(count1, 1);
      assert.strictEqual(count2, 2);
      assert.strictEqual(count1After, 0);
      assert.strictEqual(count2After, 2);
    });
  });

  // ============================================================================
  // Flush Bookkeeping Tests
  // ============================================================================

  describe("Flush Bookkeeping", () => {
    it("expires unread events after two flushes", async () => {
      const world = createWorld();
      const Event = defineEvent("FlushExpiry", { schema: { value: Type.i32() } });
      const seen: number[] = [];
      let frame = 0;

      addSystem(
        world,
        defineSystem("lateReader", function lateReader() {
          frame++;
          if (frame < 3) return;
          readEvents(world, Event, (e) => seen.push(e.value));
        })
      );

      emitEvent(world, Event, { value: 1 });
      await runOnce(world);
      await runOnce(world);
      await runOnce(world);

      assert.deepStrictEqual(seen, []);
    });

    it("keeps read-only queues out of the active list", async () => {
      const world = createWorld();
      const Event = defineEvent("FlushReadOnly");

      addSystem(
        world,
        defineSystem("reader", function reader() {
          hasEvents(world, Event);
        })
      );

      await runOnce(world);

      assert.strictEqual(world.events.byId.get(Event.id)!.active, false);
      assert.strictEqual(world.events.active.length, 0);
    });

    it("re-emitting re-activates a drained queue and delivers its events", async () => {
      const world = createWorld();
      const Event = defineEvent("FlushReactivate", { schema: { value: Type.i32() } });
      const seen: number[] = [];

      addSystem(
        world,
        defineSystem("reader", function reader() {
          readEvents(world, Event, (e) => {
            seen.push(e.value);
          });
        })
      );

      emitEvent(world, Event, { value: 1 });
      await runOnce(world);
      await runOnce(world);

      emitEvent(world, Event, { value: 2 });
      const queue = world.events.byId.get(Event.id)!;
      assert.strictEqual(queue.active, true);

      await runOnce(world);

      assert.deepStrictEqual(seen, [1, 2]);
    });
  });

  // ============================================================================
  // Vector Schema Events
  // ============================================================================

  describe("Vector Schema Events", () => {
    it("round-trips vector field data through emit and read", async () => {
      const world = createWorld();
      const MoveEvent = defineEvent("MoveVec", { schema: { position: Type.f32(3) } });
      let result: [number, number, number] | undefined;

      addSystem(
        world,
        defineSystem("reader", function reader() {
          readEvents(world, MoveEvent, (e) => {
            result = e.position;
          });
        })
      );

      emitEvent(world, MoveEvent, { position: [1.5, 2.5, 3.5] });
      await runOnce(world);

      assert.deepStrictEqual(result, [1.5, 2.5, 3.5]);
    });

    it("handles mixed scalar and vector fields", async () => {
      const world = createWorld();
      const HitEvent = defineEvent("HitMixed", {
        schema: {
          position: Type.f32(3),
          damage: Type.f32(),
          source: Type.u32(),
        },
      });
      const results: Array<{ position: [number, number, number]; damage: number; source: number }> = [];

      addSystem(
        world,
        defineSystem("reader", function reader() {
          readEvents(world, HitEvent, (e) => {
            results.push({ position: e.position, damage: e.damage, source: e.source });
          });
        })
      );

      emitEvent(world, HitEvent, { position: [1, 2, 3], damage: 50.5, source: 42 });
      emitEvent(world, HitEvent, { position: [4, 5, 6], damage: 25, source: 7 });
      await runOnce(world);

      assert.deepStrictEqual(results, [
        { position: [1, 2, 3], damage: 50.5, source: 42 },
        { position: [4, 5, 6], damage: 25, source: 7 },
      ]);
    });
  });

  // ============================================================================
  // Cross-Schedule Event Visibility Tests
  // ============================================================================

  describe("Cross-Schedule Event Visibility", () => {
    it("between-frame events visible to systems on next frame", async () => {
      const world = createWorld();
      const Event = defineEvent("BetweenFrame", { schema: { value: Type.i32() } });

      const seen: number[] = [];

      addSystem(
        world,
        defineSystem("reader", function reader() {
          readEvents(world, Event, (e) => {
            seen.push(e.value);
          });
        })
      );

      // First frame: no events
      await runOnce(world);
      assert.deepStrictEqual(seen, []);

      // Emit between frames (outside system context)
      emitEvent(world, Event, { value: 42 });

      // Second frame: reader should see the between-frame event
      await runOnce(world);
      assert.deepStrictEqual(seen, [42]);
    });

    it("later system's events visible to earlier system on next frame", async () => {
      const world = createWorld();
      const Event = defineEvent("LaterToEarlier", { schema: { value: Type.i32() } });

      const readerSeen: number[] = [];

      // Reader runs first
      const reader = defineSystem("reader", (world) => {
        readEvents(world, Event, (e) => {
          readerSeen.push(e.value);
        });
      });

      addSystem(world, reader);

      // Writer runs second
      let writeRun = 0;
      addSystem(
        world,
        defineSystem("writer", function writer() {
          writeRun++;
          if (writeRun === 1) {
            emitEvent(world, Event, { value: 99 });
          }
        }),
        { after: [reader] }
      );

      // First frame: reader sees nothing, writer emits
      await runOnce(world);
      assert.deepStrictEqual(readerSeen, []);

      // Second frame: reader should now see the event from the previous frame's writer
      await runOnce(world);
      assert.deepStrictEqual(readerSeen, [99]);
    });
  });
});
