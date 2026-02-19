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
  /**
   * Entity count per iteration for throughput scaling.
   * Static (constant or per-preset) or dynamic (function called after setup
   * with the populated world, so query-match counts stay in sync with the
   * actual entity distribution).
   */
  // biome-ignore lint/suspicious/noExplicitAny: world type varies per library adapter
  entityCount?: number | Partial<Record<PresetName, number>> | ((world: any) => number);
};

export type Suite = {
  name: string;
  benchmarks: BenchmarkDef[];
};

export type MemoryResult = {
  label: string;
  /** Mean of positive per-iteration deltas (average bytes allocated per op). */
  allocPerOp: number;
  /** Minimum positive per-iteration delta. */
  allocMin: number;
  /** Maximum positive per-iteration delta. */
  allocMax: number;
  /** 99th percentile of positive per-iteration deltas. */
  allocP99: number;
  /** Number of iterations where GC fired (negative delta). */
  gcCycles: number;
  /** Net retained delta after final GC (leak indicator). */
  retained: number;
  /** Positive deltas sorted ascending, for histogram rendering. */
  posDeltas: number[];
  iterations: number;
};
