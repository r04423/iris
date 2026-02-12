import { type Component, defineComponent, defineTag, type Tag, Type } from "iris-ecs";

// ============================================================================
// Generated fixtures
// ============================================================================

export const GENERATED_COMPONENTS: Component[] = Array.from({ length: 400 }, (_, i) =>
  defineComponent(`BenchGen_Comp_${i}`, { v: Type.f32() })
);

export const GENERATED_TAGS: Tag[] = Array.from({ length: 400 }, (_, i) => defineTag(`BenchGen_Tag_${i}`));
