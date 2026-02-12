export type PresetName = "empty" | "xsmall" | "small" | "medium" | "large";

// biome-ignore lint/suspicious/noExplicitAny: world type varies per library adapter
export type PresetFactory = () => any;

export type BenchmarkDef = {
  name: string;
  presets: PresetName[];
  // biome-ignore lint/suspicious/noExplicitAny: world type varies per library adapter
  fn: (world: any) => void;
  // biome-ignore lint/suspicious/noExplicitAny: world type varies per library adapter
  setup?: (world: any) => void;
  /** Entity count per iteration for throughput scaling. Constant or per-preset. */
  entityCount?: number | Partial<Record<PresetName, number>>;
};

export type Suite = {
  name: string;
  benchmarks: BenchmarkDef[];
};

export type MemoryResult = {
  label: string;
  deltaPerOp: number;
  totalDelta: number;
  totalMemory: number;
  iterations: number;
};
