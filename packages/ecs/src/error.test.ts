import assert from "node:assert";
import { describe, it } from "node:test";
import {
  Duplicate,
  InvalidArgument,
  InvalidState,
  IrisError,
  assert as irisAssert,
  LimitExceeded,
  NotFound,
} from "./error.js";

describe("Error", () => {
  describe("IrisError", () => {
    it("sets name to subclass name", () => {
      const error = new LimitExceeded({ resource: "Entity", max: 100 });

      assert.strictEqual(error.name, "LimitExceeded");
    });

    it("is instanceof Error and IrisError", () => {
      const error = new NotFound({ resource: "Entity", id: 42 });

      assert.ok(error instanceof Error);
      assert.ok(error instanceof IrisError);
      assert.ok(error instanceof NotFound);
    });

    it("supports cause chaining", () => {
      const cause = new Error("original");
      const error = new IrisError("wrapped", { cause });

      assert.strictEqual(error.cause, cause);
    });
  });

  describe("LimitExceeded", () => {
    it("constructs with resource and max", () => {
      const error = new LimitExceeded({ resource: "Tag", max: 1048576 });

      assert.strictEqual(error.resource, "Tag");
      assert.strictEqual(error.max, 1048576);
      assert.strictEqual(error.id, undefined);
      assert.strictEqual(error.message, "Tag limit exceeded: max 1048576");
    });

    it("includes id when provided", () => {
      const error = new LimitExceeded({ resource: "Entity", max: 1048576, id: 1048577 });

      assert.strictEqual(error.id, 1048577);
      assert.strictEqual(error.message, "Entity limit exceeded: max 1048576 (cannot allocate ID 1048577)");
    });
  });

  describe("NotFound", () => {
    it("constructs with resource and id", () => {
      const error = new NotFound({ resource: "Entity", id: 42 });

      assert.strictEqual(error.resource, "Entity");
      assert.strictEqual(error.id, 42);
      assert.strictEqual(error.context, undefined);
      assert.strictEqual(error.message, 'Entity "42" not found');
    });

    it("includes context when provided", () => {
      const error = new NotFound({ resource: "Schedule", id: "Physics", context: "pipeline" });

      assert.strictEqual(error.context, "pipeline");
      assert.strictEqual(error.message, 'Schedule "Physics" not found in pipeline');
    });
  });

  describe("Duplicate", () => {
    it("constructs with resource and id", () => {
      const error = new Duplicate({ resource: "System", id: "physics" });

      assert.strictEqual(error.resource, "System");
      assert.strictEqual(error.id, "physics");
      assert.strictEqual(error.message, 'System "physics" already exists');
    });
  });

  describe("InvalidArgument", () => {
    it("constructs with expected only", () => {
      const error = new InvalidArgument({ expected: "non-empty name" });

      assert.strictEqual(error.expected, "non-empty name");
      assert.strictEqual(error.actual, undefined);
      assert.strictEqual(error.message, "Invalid argument: expected non-empty name");
    });

    it("includes actual when provided", () => {
      const error = new InvalidArgument({ expected: "named function", actual: "anonymous" });

      assert.strictEqual(error.actual, "anonymous");
      assert.strictEqual(error.message, "Invalid argument: expected named function, got anonymous");
    });
  });

  describe("InvalidState", () => {
    it("constructs with message", () => {
      const error = new InvalidState({ message: "Circular dependency detected" });

      assert.strictEqual(error.message, "Circular dependency detected");
    });
  });

  describe("assert", () => {
    it("passes on truthy condition", () => {
      assert.doesNotThrow(() => {
        irisAssert(true, LimitExceeded, { resource: "Entity", max: 100 });
      });
    });

    it("passes on truthy non-boolean values", () => {
      assert.doesNotThrow(() => {
        irisAssert(1, LimitExceeded, { resource: "Entity", max: 100 });
        irisAssert("hello", LimitExceeded, { resource: "Entity", max: 100 });
        irisAssert({}, LimitExceeded, { resource: "Entity", max: 100 });
      });
    });

    it("throws correct error class on falsy condition", () => {
      assert.throws(() => irisAssert(false, LimitExceeded, { resource: "Entity", max: 100 }), LimitExceeded);

      assert.throws(() => irisAssert(0, NotFound, { resource: "System", id: "foo" }), NotFound);

      assert.throws(() => irisAssert(null, Duplicate, { resource: "Schedule", id: "Update" }), Duplicate);

      assert.throws(() => irisAssert(undefined, InvalidArgument, { expected: "name" }), InvalidArgument);

      assert.throws(() => irisAssert("", InvalidState, { message: "bad state" }), InvalidState);
    });

    it("constructs error with correct params", () => {
      try {
        irisAssert(false, LimitExceeded, { resource: "Tag", max: 256, id: 257 });
        assert.fail("should have thrown");
      } catch (error) {
        assert.ok(error instanceof LimitExceeded);
        assert.strictEqual(error.resource, "Tag");
        assert.strictEqual(error.max, 256);
        assert.strictEqual(error.id, 257);
      }
    });
  });
});
