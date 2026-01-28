import assert from "node:assert";
import { describe, it } from "node:test";
import { addComponent, hasComponent, setComponentValue } from "./component.js";
import { createEntity, destroyEntity } from "./entity.js";
import { getName, lookupByName, Name, removeName, setName } from "./name.js";
import { defineComponent, defineTag } from "./registry.js";
import { Type } from "./schema.js";
import { createWorld } from "./world.js";

describe("Name", () => {
  describe("Name System", () => {
    it("sets and gets entity name", () => {
      const world = createWorld();
      const entity = createEntity(world);

      setName(world, entity, "player-1");

      assert.strictEqual(getName(world, entity), "player-1");
      assert.strictEqual(hasComponent(world, entity, Name), true);
    });

    it("removes entity name", () => {
      const world = createWorld();
      const entity = createEntity(world);

      setName(world, entity, "player-1");
      removeName(world, entity);

      assert.strictEqual(getName(world, entity), undefined);
      assert.strictEqual(hasComponent(world, entity, Name), false);
      assert.strictEqual(lookupByName(world, "player-1"), undefined);
    });

    it("throws on empty name", () => {
      const world = createWorld();
      const entity = createEntity(world);

      assert.throws(() => setName(world, entity, ""), /Name cannot be empty/);
    });

    it("throws on name collision", () => {
      const world = createWorld();
      const entity1 = createEntity(world);
      const entity2 = createEntity(world);

      setName(world, entity1, "player");

      assert.throws(() => setName(world, entity2, "player"), /Name "player" already exists/);
    });

    it("updates name and registry on change", () => {
      const world = createWorld();
      const entity = createEntity(world);

      setName(world, entity, "old-name");
      setName(world, entity, "new-name");

      assert.strictEqual(getName(world, entity), "new-name");
      assert.strictEqual(lookupByName(world, "old-name"), undefined);
      assert.strictEqual(lookupByName(world, "new-name"), entity);
    });

    it("looks up entity by name", () => {
      const world = createWorld();
      const entity = createEntity(world);

      setName(world, entity, "player-1");

      assert.strictEqual(lookupByName(world, "player-1"), entity);
      assert.strictEqual(lookupByName(world, "nonexistent"), undefined);
    });

    it("looks up entity with component validation", () => {
      const world = createWorld();
      const Position = defineComponent("Position", { x: Type.f32(), y: Type.f32() });
      const Health = defineTag("Health");
      const entity = createEntity(world);

      setName(world, entity, "player");
      addComponent(world, entity, Position, { x: 0, y: 0 });

      // Has Position but not Health
      assert.strictEqual(lookupByName(world, "player", Position), entity);
      assert.strictEqual(lookupByName(world, "player", Health), undefined);
      assert.strictEqual(lookupByName(world, "player", Position, Health), undefined);

      // Add Health
      addComponent(world, entity, Health);
      assert.strictEqual(lookupByName(world, "player", Position, Health), entity);
    });

    it("cleans up registry on entity destruction", () => {
      const world = createWorld();
      const entity = createEntity(world);

      setName(world, entity, "player");
      assert.strictEqual(lookupByName(world, "player"), entity);

      destroyEntity(world, entity);
      assert.strictEqual(lookupByName(world, "player"), undefined);
    });

    it("maintains independent registries per world", () => {
      const world1 = createWorld();
      const world2 = createWorld();
      const entity1 = createEntity(world1);
      const entity2 = createEntity(world2);

      setName(world1, entity1, "shared-name");
      setName(world2, entity2, "shared-name");

      assert.strictEqual(lookupByName(world1, "shared-name"), entity1);
      assert.strictEqual(lookupByName(world2, "shared-name"), entity2);
    });

    it("registers name when adding Name component directly", () => {
      const world = createWorld();
      const entity = createEntity(world);

      addComponent(world, entity, Name, { value: "direct-add" });

      assert.strictEqual(getName(world, entity), "direct-add");
      assert.strictEqual(lookupByName(world, "direct-add"), entity);
    });

    it("updates registry when changing Name component value directly", () => {
      const world = createWorld();
      const entity = createEntity(world);

      addComponent(world, entity, Name, { value: "original" });
      setComponentValue(world, entity, Name, "value", "updated");

      assert.strictEqual(getName(world, entity), "updated");
      assert.strictEqual(lookupByName(world, "original"), undefined);
      assert.strictEqual(lookupByName(world, "updated"), entity);
    });

    it("destroying entity without name does not error", () => {
      const world = createWorld();
      const entity = createEntity(world);

      // Entity has no name, early return in entityDestroyed observer
      assert.doesNotThrow(() => destroyEntity(world, entity));
    });

    it("setting same name value is no-op", () => {
      const world = createWorld();
      const entity = createEntity(world);

      setName(world, entity, "foo");
      // Same value, early return in componentChanged observer
      setName(world, entity, "foo");

      assert.strictEqual(getName(world, entity), "foo");
      assert.strictEqual(lookupByName(world, "foo"), entity);
    });

    it("removeName on entity without name is no-op", () => {
      const world = createWorld();
      const entity = createEntity(world);

      // No name, early return in removeName
      assert.doesNotThrow(() => removeName(world, entity));
      assert.strictEqual(getName(world, entity), undefined);
    });
  });
});
