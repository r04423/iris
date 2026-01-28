import assert from "node:assert";
import { describe, it } from "node:test";
import {
  clearEvents,
  countEvents,
  defineEvent,
  EVENT_EXPIRY_TICKS,
  emitEvent,
  fetchEvents,
  fetchLastEvent,
  hasEvents,
} from "./event.js";
import { addSystem, buildSchedule, executeSchedule } from "./scheduler.js";
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
        target: Type.u32(),
        amount: Type.f32(),
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

    it("allows same name for different events", () => {
      const First = defineEvent("SameName");
      const Second = defineEvent("SameName");

      assert.notStrictEqual(First.id, Second.id);
    });
  });

  // ============================================================================
  // Event Emission Tests
  // ============================================================================

  describe("Event Emission", () => {
    it("emits tag event without data argument", () => {
      const world = createWorld();
      const GameStarted = defineEvent("EmitTagEvent");

      emitEvent(world, GameStarted);

      assert.strictEqual(hasEvents(world, GameStarted), true);
    });

    it("emits data event with data argument", () => {
      const world = createWorld();
      const DamageDealt = defineEvent("EmitDamageEvent", {
        target: Type.u32(),
        amount: Type.f32(),
      });

      emitEvent(world, DamageDealt, { target: 1, amount: 25.5 });

      assert.strictEqual(hasEvents(world, DamageDealt), true);
    });

    it("emits multiple events of same type", () => {
      const world = createWorld();
      const Hit = defineEvent("MultiHit", {
        damage: Type.f32(),
      });

      emitEvent(world, Hit, { damage: 10 });
      emitEvent(world, Hit, { damage: 20 });
      emitEvent(world, Hit, { damage: 30 });

      assert.strictEqual(countEvents(world, Hit), 3);
    });

    it("creates queue lazily on first emit", () => {
      const world = createWorld();
      const Event = defineEvent("LazyQueue");

      assert.strictEqual(world.events.byId.has(Event.id), false);

      emitEvent(world, Event);

      assert.strictEqual(world.events.byId.has(Event.id), true);
    });
  });

  // ============================================================================
  // Event Fetch Tests
  // ============================================================================

  describe("Event Fetching", () => {
    it("fetches emitted events", () => {
      const world = createWorld();
      const Event = defineEvent("FetchBasic", {
        value: Type.i32(),
      });

      emitEvent(world, Event, { value: 42 });

      const results = [...fetchEvents(world, Event)];

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0]?.value, 42);
    });

    it("fetches multiple events in order", () => {
      const world = createWorld();
      const Event = defineEvent("FetchMultiple", {
        value: Type.i32(),
      });

      emitEvent(world, Event, { value: 1 });
      emitEvent(world, Event, { value: 2 });
      emitEvent(world, Event, { value: 3 });

      const results = [...fetchEvents(world, Event)];

      assert.strictEqual(results.length, 3);
      assert.strictEqual(results[0]?.value, 1);
      assert.strictEqual(results[1]?.value, 2);
      assert.strictEqual(results[2]?.value, 3);
    });

    it("marks events as read after fetch", () => {
      const world = createWorld();
      const Event = defineEvent("FetchMarksRead");

      emitEvent(world, Event);

      // First fetch sees events
      const first = [...fetchEvents(world, Event)];
      assert.strictEqual(first.length, 1);

      // Second fetch (same tick) sees nothing - already read
      const second = [...fetchEvents(world, Event)];
      assert.strictEqual(second.length, 0);
    });

    it("fetches tag events with undefined data", () => {
      const world = createWorld();
      const TagEvent = defineEvent("FetchTag");

      emitEvent(world, TagEvent);

      const results = [...fetchEvents(world, TagEvent)];

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0], undefined);
    });

    it("creates queue lazily on fetch", () => {
      const world = createWorld();
      const Event = defineEvent("LazyFetch");

      // Queue doesn't exist yet
      assert.strictEqual(world.events.byId.has(Event.id), false);

      // Fetching creates empty queue
      const results = [...fetchEvents(world, Event)];

      assert.strictEqual(results.length, 0);
      assert.strictEqual(world.events.byId.has(Event.id), true);
    });
  });

  // ============================================================================
  // fetchLastEvent Tests
  // ============================================================================

  describe("fetchLastEvent", () => {
    it("returns undefined for empty queue", () => {
      const world = createWorld();
      const Event = defineEvent("LastEmpty");

      const result = fetchLastEvent(world, Event);

      assert.strictEqual(result, undefined);
    });

    it("returns most recent event only", () => {
      const world = createWorld();
      const Event = defineEvent("LastRecent", {
        value: Type.i32(),
      });

      emitEvent(world, Event, { value: 1 });
      emitEvent(world, Event, { value: 2 });
      emitEvent(world, Event, { value: 3 });

      const result = fetchLastEvent(world, Event);

      assert.strictEqual(result?.value, 3);
    });

    it("marks all events as read", () => {
      const world = createWorld();
      const Event = defineEvent("LastMarksRead", {
        value: Type.i32(),
      });

      emitEvent(world, Event, { value: 1 });
      emitEvent(world, Event, { value: 2 });

      fetchLastEvent(world, Event);

      assert.strictEqual(countEvents(world, Event), 0);
    });
  });

  // ============================================================================
  // hasEvents and countEvents Tests
  // ============================================================================

  describe("hasEvents and countEvents", () => {
    it("hasEvents returns false for empty queue", () => {
      const world = createWorld();
      const Event = defineEvent("HasEmpty");

      assert.strictEqual(hasEvents(world, Event), false);
    });

    it("hasEvents returns true when events exist", () => {
      const world = createWorld();
      const Event = defineEvent("HasEvents");

      emitEvent(world, Event);

      assert.strictEqual(hasEvents(world, Event), true);
    });

    it("countEvents returns 0 for empty queue", () => {
      const world = createWorld();
      const Event = defineEvent("CountEmpty");

      assert.strictEqual(countEvents(world, Event), 0);
    });

    it("countEvents returns correct count", () => {
      const world = createWorld();
      const Event = defineEvent("CountEvents");

      emitEvent(world, Event);
      emitEvent(world, Event);
      emitEvent(world, Event);

      assert.strictEqual(countEvents(world, Event), 3);
    });

    it("hasEvents does not mark events as read", () => {
      const world = createWorld();
      const Event = defineEvent("HasNoMark");

      emitEvent(world, Event);

      hasEvents(world, Event);
      hasEvents(world, Event);

      // Events should still be available
      assert.strictEqual(countEvents(world, Event), 1);
    });

    it("countEvents does not mark events as read", () => {
      const world = createWorld();
      const Event = defineEvent("CountNoMark");

      emitEvent(world, Event);
      emitEvent(world, Event);

      countEvents(world, Event);
      countEvents(world, Event);

      // Events should still be available
      const results = [...fetchEvents(world, Event)];
      assert.strictEqual(results.length, 2);
    });
  });

  // ============================================================================
  // clearEvents Tests
  // ============================================================================

  describe("clearEvents", () => {
    it("marks events as read without processing", () => {
      const world = createWorld();
      const Event = defineEvent("ClearEvents", {
        value: Type.i32(),
      });

      emitEvent(world, Event, { value: 1 });
      emitEvent(world, Event, { value: 2 });

      clearEvents(world, Event);

      // Events should now be marked as read
      assert.strictEqual(countEvents(world, Event), 0);
      assert.strictEqual(hasEvents(world, Event), false);
    });
  });

  // ============================================================================
  // Per-System Isolation Tests
  // ============================================================================

  describe("Per-System Isolation", () => {
    it("multiple systems see same events independently", () => {
      const world = createWorld();
      const Event = defineEvent("IsolationTest", {
        value: Type.i32(),
      });

      const system1Results: number[] = [];
      const system2Results: number[] = [];

      addSystem(world, function system1() {
        for (const e of fetchEvents(world, Event)) {
          system1Results.push(e.value);
        }
      });

      addSystem(world, function system2() {
        for (const e of fetchEvents(world, Event)) {
          system2Results.push(e.value);
        }
      });

      buildSchedule(world);

      // Emit event before execution
      emitEvent(world, Event, { value: 42 });

      executeSchedule(world);

      // Both systems should see the same event
      assert.deepStrictEqual(system1Results, [42]);
      assert.deepStrictEqual(system2Results, [42]);
    });

    it("per-system lastTick stored in bySystemId map", () => {
      const world = createWorld();
      const Event = defineEvent("SystemIdMap");

      addSystem(world, function systemA() {
        for (const _ of fetchEvents(world, Event)) {
          // consume
        }
      });

      addSystem(world, function systemB() {
        // don't consume
      });

      buildSchedule(world);

      emitEvent(world, Event);
      executeSchedule(world); // tick increments to 2, then systems run

      const queue = world.events.byId.get(Event.id);
      assert.ok(queue);
      // systemA fetched at tick 2, so lastTick is 2
      assert.strictEqual(queue.lastTick.bySystemId.get("systemA"), 2);
      // systemB never called fetchEvents
      assert.strictEqual(queue.lastTick.bySystemId.has("systemB"), false);
    });
  });

  // ============================================================================
  // Tick-Based Expiry Tests
  // ============================================================================

  describe("Tick-Based Expiry", () => {
    it("expiry constant is 2 ticks", () => {
      assert.strictEqual(EVENT_EXPIRY_TICKS, 2);
    });

    it("events persist for expiry window", () => {
      const world = createWorld();
      const Event = defineEvent("ExpiryPersist");

      addSystem(world, function noop() {});
      buildSchedule(world);

      // Tick 1: emit event
      emitEvent(world, Event);
      executeSchedule(world); // tick becomes 2

      // Tick 2: event should still exist
      executeSchedule(world); // tick becomes 3

      // Event emitted at tick 1, current tick 3
      // Expiry threshold = 3 - 2 = 1, events with tick <= 1 expire
      // Our event was at tick 1, so it should expire after this read
      const queue = world.events.byId.get(Event.id);
      assert.ok(queue);
      // Events haven't been cleaned up yet (cleanup happens on fetch)
      assert.strictEqual(queue.events.length, 1);
    });

    it("events expire after cleanup on fetch", () => {
      const world = createWorld();
      const Event = defineEvent("ExpiryCleanup");

      let eventCount = 0;
      addSystem(world, function counter() {
        eventCount = countEvents(world, Event);
        // Trigger cleanup by fetching
        for (const _ of fetchEvents(world, Event)) {
          // consume
        }
      });
      buildSchedule(world);

      // Tick 1: emit event
      emitEvent(world, Event);
      executeSchedule(world); // tick 2, counter sees 1 event

      const countAfterTick1 = eventCount;

      executeSchedule(world); // tick 3, counter sees 0 (already consumed at tick 2)
      executeSchedule(world); // tick 4

      // Event was emitted at tick 1, consumed at tick 2
      // By tick 4, event should be cleaned up (expiry = tick - 2 = 2, event tick 1 <= 2)
      const queue = world.events.byId.get(Event.id);
      assert.ok(queue);
      assert.strictEqual(queue.events.length, 0);
      assert.strictEqual(countAfterTick1, 1);
    });

    it("only expired events are removed", () => {
      const world = createWorld();
      const Event = defineEvent("PartialExpiry", {
        value: Type.i32(),
      });

      addSystem(world, function noop() {});
      buildSchedule(world);

      // World starts at tick 1
      emitEvent(world, Event, { value: 1 }); // emitted at tick 1
      executeSchedule(world); // tick becomes 2

      emitEvent(world, Event, { value: 2 }); // emitted at tick 2
      executeSchedule(world); // tick becomes 3

      emitEvent(world, Event, { value: 3 }); // emitted at tick 3
      executeSchedule(world); // tick becomes 4

      // At tick 4, expiry threshold = 4-2 = 2
      // - Event 1 (tick 1): 1 <= 2, EXPIRED
      // - Event 2 (tick 2): 2 <= 2, EXPIRED
      // - Event 3 (tick 3): 3 > 2, VALID

      // Fetch triggers cleanup
      const values = [...fetchEvents(world, Event)].map((e) => e.value);
      assert.deepStrictEqual(values, [1, 2, 3]); // all visible before cleanup

      const queue = world.events.byId.get(Event.id);
      assert.ok(queue);
      // After cleanup, only event 3 remains (not expired)
      assert.strictEqual(queue.events.length, 1);
      assert.strictEqual(queue.events[0]?.data.value, 3);
    });
  });

  // ============================================================================
  // Same-System Multiple Calls Tests
  // ============================================================================

  describe("Same-System Multiple Calls", () => {
    it("second fetch in same system sees no events", () => {
      const world = createWorld();
      const Event = defineEvent("SameSystemMulti");

      let firstCallCount = 0;
      let secondCallCount = 0;

      addSystem(world, function multiCall() {
        // First iteration
        for (const _ of fetchEvents(world, Event)) {
          firstCallCount++;
        }

        // Second iteration in same system run
        for (const _ of fetchEvents(world, Event)) {
          secondCallCount++;
        }
      });

      buildSchedule(world);

      emitEvent(world, Event);
      emitEvent(world, Event);
      executeSchedule(world);

      assert.strictEqual(firstCallCount, 2);
      assert.strictEqual(secondCallCount, 0);
    });

    it("lastTick updates after first fetch", () => {
      const world = createWorld();
      const Event = defineEvent("LastTickUpdate");

      addSystem(world, function checker() {
        const queue = world.events.byId.get(Event.id);
        assert.ok(queue);

        // Before fetch, lastTick for this system should be 0 (unset)
        const beforeTick = queue.lastTick.bySystemId.get("checker") ?? 0;

        for (const _ of fetchEvents(world, Event)) {
          // consume
        }

        // After fetch, lastTick should be current tick
        const afterTick = queue.lastTick.bySystemId.get("checker");
        assert.strictEqual(afterTick, world.execution.tick);
        assert.notStrictEqual(beforeTick, afterTick);
      });

      buildSchedule(world);

      emitEvent(world, Event);
      executeSchedule(world);
    });

    it("events emitted during iteration are visible on next tick", () => {
      const world = createWorld();
      const Event = defineEvent("EmitDuringIter", {
        value: Type.i32(),
      });

      const seen: number[] = [];

      addSystem(world, function emitter() {
        for (const e of fetchEvents(world, Event)) {
          seen.push(e.value);
          // Emit new event during iteration (will be at current tick)
          if (e.value < 3) {
            emitEvent(world, Event, { value: e.value + 1 });
          }
        }
      });

      buildSchedule(world);

      emitEvent(world, Event, { value: 1 });
      executeSchedule(world); // tick 2: sees value=1, emits value=2

      // Event with value=2 was emitted at tick=2
      // lastTick is now 2, so it won't see the new event in the same tick
      // On next tick, it should see value=2

      executeSchedule(world); // tick 3: sees value=2, emits value=3

      executeSchedule(world); // tick 4: sees value=3, doesn't emit

      assert.deepStrictEqual(seen, [1, 2, 3]);
    });
  });

  // ============================================================================
  // Edge Cases and Outside System Context
  // ============================================================================

  describe("Edge Cases", () => {
    it("works outside system context using lastTick.self", () => {
      const world = createWorld();
      const Event = defineEvent("OutsideSystem", {
        value: Type.i32(),
      });

      emitEvent(world, Event, { value: 42 });

      // Fetch outside of any system
      const results = [...fetchEvents(world, Event)];

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0]?.value, 42);

      // Second fetch sees nothing
      const secondResults = [...fetchEvents(world, Event)];
      assert.strictEqual(secondResults.length, 0);
    });

    it("outside context uses lastTick.self", () => {
      const world = createWorld();
      const Event = defineEvent("SelfTick");

      emitEvent(world, Event);

      const queue = world.events.byId.get(Event.id);
      assert.ok(queue);

      // Before fetch, self should be 0
      assert.strictEqual(queue.lastTick.self, 0);

      for (const _ of fetchEvents(world, Event)) {
        // consume
      }

      // After fetch, self should be updated
      assert.strictEqual(queue.lastTick.self, world.execution.tick);
    });

    it("system context and outside context track independently", () => {
      const world = createWorld();
      const Event = defineEvent("IndependentContext", {
        value: Type.i32(),
      });

      const systemResults: number[] = [];

      addSystem(world, function reader() {
        for (const e of fetchEvents(world, Event)) {
          systemResults.push(e.value);
        }
      });

      buildSchedule(world);

      emitEvent(world, Event, { value: 1 });

      // Read outside system
      const outsideResults = [...fetchEvents(world, Event)];
      assert.strictEqual(outsideResults.length, 1);
      assert.strictEqual(outsideResults[0]?.value, 1);

      // System should still see the event (independent tracking)
      executeSchedule(world);
      assert.deepStrictEqual(systemResults, [1]);
    });

    it("handles empty event queue gracefully", () => {
      const world = createWorld();
      const Event = defineEvent("EmptyQueue");

      // Fetch from non-existent queue
      const results = [...fetchEvents(world, Event)];
      assert.strictEqual(results.length, 0);

      assert.strictEqual(hasEvents(world, Event), false);
      assert.strictEqual(countEvents(world, Event), 0);
      assert.strictEqual(fetchLastEvent(world, Event), undefined);
    });

    it("generator cleanup runs on early break", () => {
      const world = createWorld();
      const Event = defineEvent("EarlyBreak", {
        value: Type.i32(),
      });

      emitEvent(world, Event, { value: 1 });
      emitEvent(world, Event, { value: 2 });
      emitEvent(world, Event, { value: 3 });

      // Break early after first event
      for (const e of fetchEvents(world, Event)) {
        if (e.value === 1) break;
      }

      // lastTick should still be updated (finally block runs)
      // Second fetch should see nothing
      const results = [...fetchEvents(world, Event)];
      assert.strictEqual(results.length, 0);
    });

    it("handles events emitted at tick 0", () => {
      // Edge case: events emitted before any schedule execution
      const world = createWorld();
      const Event = defineEvent("TickZero");

      // World starts at tick 1, so this shouldn't happen normally
      // But let's verify the system handles the initial state correctly
      emitEvent(world, Event);

      // Event emitted at tick 1 (initial tick)
      const queue = world.events.byId.get(Event.id);
      assert.ok(queue);
      assert.strictEqual(queue.events[0]?.tick, 1);

      // Should be fetchable since lastTick starts at 0
      const results = [...fetchEvents(world, Event)];
      assert.strictEqual(results.length, 1);
    });

    it("different event types are independent", () => {
      const world = createWorld();
      const Event1 = defineEvent("Independent1");
      const Event2 = defineEvent("Independent2");

      emitEvent(world, Event1);
      emitEvent(world, Event2);
      emitEvent(world, Event2);

      assert.strictEqual(countEvents(world, Event1), 1);
      assert.strictEqual(countEvents(world, Event2), 2);

      // Fetch Event1 only
      for (const _ of fetchEvents(world, Event1)) {
        // consume
      }

      // Event2 should still be available
      assert.strictEqual(countEvents(world, Event1), 0);
      assert.strictEqual(countEvents(world, Event2), 2);
    });

    it("hasEvents works outside system context", () => {
      const world = createWorld();
      const Event = defineEvent("HasEventsOutside", { value: Type.i32() });

      emitEvent(world, Event, { value: 1 });

      // hasEvents outside system context uses lastTick.self branch
      assert.strictEqual(hasEvents(world, Event), true);
    });

    it("fetchLastEvent works outside system context", () => {
      const world = createWorld();
      const Event = defineEvent("FetchLastOutside", { value: Type.i32() });

      emitEvent(world, Event, { value: 42 });

      // fetchLastEvent outside system context uses lastTick.self branch
      const event = fetchLastEvent(world, Event);
      assert.strictEqual(event?.value, 42);
    });

    it("hasEvents works inside system context", () => {
      const world = createWorld();
      const Event = defineEvent("HasEventsInsideSystem", { value: Type.i32() });
      let result = false;

      addSystem(world, function testSystem() {
        result = hasEvents(world, Event);
      });

      buildSchedule(world);
      emitEvent(world, Event, { value: 1 });
      executeSchedule(world);

      assert.strictEqual(result, true);
    });

    it("fetchLastEvent works inside system context", () => {
      const world = createWorld();
      const Event = defineEvent("FetchLastInsideSystem", { value: Type.i32() });
      let result: { value: number } | undefined;

      addSystem(world, function testSystem() {
        result = fetchLastEvent(world, Event);
      });

      buildSchedule(world);
      emitEvent(world, Event, { value: 42 });
      executeSchedule(world);

      assert.strictEqual(result?.value, 42);
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe("Integration", () => {
    it("full game loop pattern", () => {
      const world = createWorld();
      const PlayerSpawned = defineEvent("PlayerSpawned", {
        entity: Type.u32(),
      });
      const PlayerDamaged = defineEvent("PlayerDamaged", {
        entity: Type.u32(),
        amount: Type.f32(),
      });

      const spawnedPlayers: number[] = [];
      const damageLog: Array<{ entity: number; amount: number }> = [];

      // Spawn system emits events
      addSystem(world, function spawnSystem() {
        if (world.execution.tick === 2) {
          emitEvent(world, PlayerSpawned, { entity: 1 });
          emitEvent(world, PlayerSpawned, { entity: 2 });
        }
      });

      // Combat system emits damage events
      addSystem(
        world,
        function combatSystem() {
          if (world.execution.tick === 3) {
            emitEvent(world, PlayerDamaged, { entity: 1, amount: 10 });
            emitEvent(world, PlayerDamaged, { entity: 2, amount: 15 });
          }
        },
        { after: "spawnSystem" }
      );

      // UI system reads both events
      addSystem(
        world,
        function uiSystem() {
          for (const e of fetchEvents(world, PlayerSpawned)) {
            spawnedPlayers.push(e.entity);
          }
          for (const e of fetchEvents(world, PlayerDamaged)) {
            damageLog.push({ entity: e.entity, amount: e.amount });
          }
        },
        { after: "combatSystem" }
      );

      // Audio system also reads events
      let audioSpawnCount = 0;
      let audioDamageCount = 0;
      addSystem(
        world,
        function audioSystem() {
          for (const _ of fetchEvents(world, PlayerSpawned)) {
            audioSpawnCount++;
          }
          for (const _ of fetchEvents(world, PlayerDamaged)) {
            audioDamageCount++;
          }
        },
        { after: "combatSystem" }
      );

      buildSchedule(world);

      // Run several ticks
      executeSchedule(world); // tick 2
      executeSchedule(world); // tick 3
      executeSchedule(world); // tick 4

      // Verify both systems received the same events
      assert.deepStrictEqual(spawnedPlayers, [1, 2]);
      assert.deepStrictEqual(damageLog, [
        { entity: 1, amount: 10 },
        { entity: 2, amount: 15 },
      ]);
      assert.strictEqual(audioSpawnCount, 2);
      assert.strictEqual(audioDamageCount, 2);
    });
  });
});
