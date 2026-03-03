import assert from "node:assert";
import { describe, it } from "node:test";
import { encodeEntity } from "iris-ecs";
import { filterEntities } from "../lib/filter-entities.js";
import type { EntitySnapshot } from "../types.js";

function snap(rawId: number, name?: string, componentCount = 1): EntitySnapshot {
  return {
    id: encodeEntity(rawId, 0),
    name,
    componentCount,
  };
}

describe("filterEntities", () => {
  const entities: EntitySnapshot[] = [
    snap(1, "Player", 5),
    snap(2, "Enemy", 4),
    snap(5, undefined, 2),
    snap(12, "Bullet", 3),
    snap(120, "Wall", 1),
  ];

  // ============================================================================
  // Empty Query
  // ============================================================================

  it("returns all entities for empty query", () => {
    const result = filterEntities(entities, "");
    assert.strictEqual(result.length, entities.length);
  });

  it("returns all entities for whitespace-only query", () => {
    const result = filterEntities(entities, "   ");
    assert.strictEqual(result.length, entities.length);
  });

  // ============================================================================
  // Name Search
  // ============================================================================

  it("matches entity by name substring (case-insensitive)", () => {
    const result = filterEntities(entities, "play");
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.name, "Player");
  });

  it("matches multiple entities by name", () => {
    const result = filterEntities(entities, "l");
    // Player, Bullet, Wall
    assert.strictEqual(result.length, 3);
  });

  it("returns empty array when no names match", () => {
    const result = filterEntities(entities, "zzz");
    assert.strictEqual(result.length, 0);
  });

  it("does not match unnamed entities in name search", () => {
    const result = filterEntities(entities, "unnamed");
    assert.strictEqual(result.length, 0);
  });

  // ============================================================================
  // ID Search
  // ============================================================================

  it("matches entity by exact ID", () => {
    const result = filterEntities(entities, "1");
    // rawId 1, 12, 120
    assert.strictEqual(result.length, 3);
  });

  it("matches entity by ID prefix", () => {
    const result = filterEntities(entities, "12");
    // rawId 12, 120
    assert.strictEqual(result.length, 2);
  });

  it("matches single entity by full ID", () => {
    const result = filterEntities(entities, "120");
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.name, "Wall");
  });

  it("returns empty array when no IDs match", () => {
    const result = filterEntities(entities, "999");
    assert.strictEqual(result.length, 0);
  });
});
