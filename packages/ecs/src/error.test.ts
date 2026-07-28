import assert from "node:assert";
import { describe, it } from "node:test";
import {
  IrisCircularDependency,
  IrisDefinitionLimitExceeded,
  IrisDuplicate,
  IrisDuplicateDefinition,
  IrisEntityLimitExceeded,
  IrisEntityNotFound,
  IrisError,
  IrisInvalidArgument,
  IrisInvalidState,
  IrisLimitExceeded,
  IrisNotFound,
  IrisSchedulerBusy,
} from "./error.js";

describe("Error", () => {
  describe("IrisError", () => {
    it("sets name to subclass name", () => {
      const error = new IrisLimitExceeded({ resource: "Entity", max: 100 });

      assert.strictEqual(error.name, "IrisLimitExceeded");
    });

    it("is instanceof Error and IrisError", () => {
      const error = new IrisNotFound({ resource: "Entity", id: 42 });

      assert.ok(error instanceof Error);
      assert.ok(error instanceof IrisError);
      assert.ok(error instanceof IrisNotFound);
    });

    it("supports cause chaining", () => {
      const cause = new Error("original");
      const error = new IrisError("wrapped", { cause });

      assert.strictEqual(error.message, "wrapped");
      assert.strictEqual(error.cause, cause);
    });
  });

  describe("IrisLimitExceeded", () => {
    it("constructs with resource and max", () => {
      const error = new IrisLimitExceeded({ resource: "Tag", max: 1048576 });

      assert.strictEqual(error.resource, "Tag");
      assert.strictEqual(error.max, 1048576);
      assert.strictEqual(error.id, undefined);
      assert.strictEqual(error.message, "Tag limit exceeded: max 1048576");
    });

    it("includes id when provided", () => {
      const error = new IrisLimitExceeded({ resource: "Entity", max: 1048576, id: 1048577 });

      assert.strictEqual(error.id, 1048577);
      assert.strictEqual(error.message, "Entity limit exceeded: max 1048576 (cannot allocate ID 1048577)");
    });
  });

  describe("IrisNotFound", () => {
    it("constructs with resource and id", () => {
      const error = new IrisNotFound({ resource: "Entity", id: 42 });

      assert.strictEqual(error.resource, "Entity");
      assert.strictEqual(error.id, 42);
      assert.strictEqual(error.context, undefined);
      assert.strictEqual(error.message, 'Entity "42" not found');
    });

    it("includes context when provided", () => {
      const error = new IrisNotFound({ resource: "Schedule", id: "Physics", context: "pipeline" });

      assert.strictEqual(error.context, "pipeline");
      assert.strictEqual(error.message, 'Schedule "Physics" not found in pipeline');
    });
  });

  describe("IrisDuplicate", () => {
    it("constructs with resource and id", () => {
      const error = new IrisDuplicate({ resource: "System", id: "physics" });

      assert.strictEqual(error.resource, "System");
      assert.strictEqual(error.id, "physics");
      assert.strictEqual(error.message, 'System "physics" already exists');
    });
  });

  describe("IrisInvalidArgument", () => {
    it("constructs with expected only", () => {
      const error = new IrisInvalidArgument({ expected: "non-empty name" });

      assert.strictEqual(error.expected, "non-empty name");
      assert.strictEqual(error.actual, undefined);
      assert.strictEqual(error.message, "Invalid argument: expected non-empty name");
    });

    it("includes actual when provided", () => {
      const error = new IrisInvalidArgument({ expected: "named function", actual: "anonymous" });

      assert.strictEqual(error.actual, "anonymous");
      assert.strictEqual(error.message, "Invalid argument: expected named function, got anonymous");
    });
  });

  describe("IrisInvalidState", () => {
    it("constructs with message", () => {
      const error = new IrisInvalidState({ message: "Circular dependency detected" });

      assert.strictEqual(error.message, "Circular dependency detected");
    });
  });

  describe("specific errors", () => {
    it("extends the matching category", () => {
      assert.ok(new IrisEntityNotFound(42) instanceof IrisNotFound);
      assert.ok(new IrisDuplicateDefinition("Position") instanceof IrisDuplicate);
      assert.ok(new IrisSchedulerBusy("busy") instanceof IrisInvalidState);
      assert.ok(new IrisEntityLimitExceeded(1048576) instanceof IrisLimitExceeded);
    });

    it("bakes fixed details into category fields", () => {
      const error = new IrisEntityLimitExceeded(1048576);

      assert.strictEqual(error.resource, "Entity");
      assert.strictEqual(error.max, 1048575);
      assert.strictEqual(error.id, 1048576);
    });

    it("selects definition limit by kind", () => {
      assert.strictEqual(new IrisDefinitionLimitExceeded("Tag").max, 1048575);
      assert.strictEqual(new IrisDefinitionLimitExceeded("Component").max, 1048575);
      assert.strictEqual(new IrisDefinitionLimitExceeded("Relation").max, 255);
    });

    it("formats circular dependency message", () => {
      const error = new IrisCircularDependency("Update", "a, b");

      assert.strictEqual(error.message, 'Circular dependency in schedule "Update": a, b');
    });
  });
});
