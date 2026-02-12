import type { MemoryResult } from "./types.js";

let didWarnAboutMissingGc = false;

/**
 * Snapshot heapUsed + external. ECS component storage may use TypedArrays whose
 * ArrayBuffer backing stores are reported in `external`, not `heapUsed`.
 * Summing both captures the full retained footprint of ECS operations.
 */
function snapshotMemory(): number {
  const mem = process.memoryUsage();
  return mem.heapUsed + mem.external;
}

/**
 * Compute allocation statistics from per-iteration deltas.
 *
 * Positive deltas represent actual allocations. Negative deltas are GC noise
 * (the collector fired mid-iteration) and are excluded from allocation stats.
 * Following mitata's approach: trim top/bottom 2 samples when > 12 positive
 * deltas to reduce outlier influence.
 */
function computeAllocStats(deltas: number[]): {
  allocPerOp: number;
  allocMin: number;
  allocMax: number;
  allocP99: number;
  gcCycles: number;
  posDeltas: number[];
} {
  let gcCycles = 0;
  const positive: number[] = [];

  for (let i = 0; i < deltas.length; i++) {
    const d = deltas[i]!;
    if (d < 0) {
      gcCycles++;
    } else if (d > 0) {
      positive.push(d);
    }
  }

  if (positive.length === 0) {
    return { allocPerOp: 0, allocMin: 0, allocMax: 0, allocP99: 0, gcCycles, posDeltas: [] };
  }

  positive.sort((a, b) => a - b);

  // Trim top/bottom 2 if enough samples
  const trimmed = positive.length > 12 ? positive.slice(2, -2) : positive;

  let sum = 0;
  for (let i = 0; i < trimmed.length; i++) {
    sum += trimmed[i]!;
  }

  const allocPerOp = sum / trimmed.length;
  const allocMin = trimmed[0]!;
  const allocMax = trimmed[trimmed.length - 1]!;
  const p99Index = Math.min(Math.ceil(trimmed.length * 0.99) - 1, trimmed.length - 1);
  const allocP99 = trimmed[p99Index]!;

  return { allocPerOp, allocMin, allocMax, allocP99, gcCycles, posDeltas: trimmed };
}

/**
 * Measure memory allocation profile and retained delta of a function.
 *
 * Two-pass measurement:
 * 1. **Per-iteration sampling** — captures heap before/after each iteration to
 *    compute allocation rate, distribution shape, and GC cycle count.
 * 2. **Retention measurement** — GC-fenced before/after snapshot to detect leaks.
 *
 * Requires `--expose-gc` to be passed to Node.
 * Without it, results are skipped with a warning.
 */
export function measureMemory(label: string, iterations: number, fn: () => void): MemoryResult {
  const gc = globalThis.gc;
  if (!gc) {
    if (!didWarnAboutMissingGc) {
      didWarnAboutMissingGc = true;
      console.warn("GC not exposed. Run with --expose-gc for memory measurements");
    }
    return {
      label,
      allocPerOp: 0,
      allocMin: 0,
      allocMax: 0,
      allocP99: 0,
      gcCycles: 0,
      retained: 0,
      posDeltas: [],
      iterations,
    };
  }

  // Warmup
  fn();
  fn();

  // Pass 1: Per-iteration heap sampling
  gc();
  const deltas: number[] = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    const before = snapshotMemory();
    fn();
    deltas[i] = snapshotMemory() - before;
  }

  const stats = computeAllocStats(deltas);

  // Pass 2: Retention measurement (GC-fenced)
  gc();
  const retBefore = snapshotMemory();

  for (let i = 0; i < iterations; i++) {
    fn();
  }

  gc();
  const retAfter = snapshotMemory();

  const retained = (retAfter - retBefore) / iterations;

  return {
    label,
    allocPerOp: stats.allocPerOp,
    allocMin: stats.allocMin,
    allocMax: stats.allocMax,
    allocP99: stats.allocP99,
    gcCycles: stats.gcCycles,
    retained,
    posDeltas: stats.posDeltas,
    iterations,
  };
}
