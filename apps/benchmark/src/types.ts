export type PresetName = "empty" | "xsmall" | "small";

// biome-ignore lint/suspicious/noExplicitAny: world type varies per library adapter
export type PresetFactory = () => any;

export type BenchmarkDef = {
  name: string;
  presets: PresetName[];
  // biome-ignore lint/suspicious/noExplicitAny: world type varies per library adapter
  fn: (world: any) => void;
  // biome-ignore lint/suspicious/noExplicitAny: world type varies per library adapter
  setup?: (world: any) => void;
};

export type Suite = {
  name: string;
  benchmarks: BenchmarkDef[];
};

export type MemoryResult = {
  label: string;
  deltaPerOp: number;
  totalDelta: number;
  iterations: number;
};
