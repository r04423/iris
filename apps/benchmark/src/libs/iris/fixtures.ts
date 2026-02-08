import { type Component, defineComponent, defineTag, type Tag, Type } from "iris-ecs";

// ---------------------------------------------------------------------------
// Named fixtures — used directly in suite benchmarks for readability
// ---------------------------------------------------------------------------

export const Position = defineComponent("Bench_Position", {
  x: Type.f32(),
  y: Type.f32(),
});

export const Velocity = defineComponent("Bench_Velocity", {
  vx: Type.f32(),
  vy: Type.f32(),
});

export const Health = defineComponent("Bench_Health", {
  hp: Type.i32(),
});

export const Damage = defineComponent("Bench_Damage", {
  amount: Type.i32(),
});

export const Player = defineTag("Bench_Player");
export const Enemy = defineTag("Bench_Enemy");
export const Active = defineTag("Bench_Active");
export const Visible = defineTag("Bench_Visible");

// ---------------------------------------------------------------------------
// Generated fixtures — for populating presets at scale
// ---------------------------------------------------------------------------

export function generateComponents(n: number): Component[] {
  const components: Component[] = [];
  for (let i = 0; i < n; i++) {
    components.push(defineComponent(`BenchGen_Comp_${i}`, { v: Type.f32() }));
  }
  return components;
}

export function generateTags(n: number): Tag[] {
  const tags: Tag[] = [];
  for (let i = 0; i < n; i++) {
    tags.push(defineTag(`BenchGen_Tag_${i}`));
  }
  return tags;
}
