import { type Component, defineComponent, type Tag, Type } from "iris-ecs";

// ============================================================================
// Generated fixtures
// ============================================================================

export const GENERATED_COMPONENTS: Component[] = Array.from({ length: 400 }, (_, i) =>
  defineComponent(`BenchGen_Comp_${i}`, { schema: { v: Type.f32() } })
);

export const GENERATED_TAGS: Tag[] = Array.from({ length: 400 }, (_, i) => defineComponent(`BenchGen_Tag_${i}`));
