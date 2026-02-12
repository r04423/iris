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
 * Measure retained memory delta of a function.
 *
 * Reports the signed difference in (heap + external) memory before and after
 * running `fn` N times. Positive means net allocation, negative means net
 * deallocation (e.g. destroy operations freeing archetype storage).
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
    return { label, deltaPerOp: 0, totalDelta: 0, totalMemory: 0, iterations };
  }

  fn();
  fn();

  gc();
  const before = snapshotMemory();

  for (let i = 0; i < iterations; i++) {
    fn();
  }

  gc();
  const after = snapshotMemory();

  const totalDelta = after - before;
  const deltaPerOp = totalDelta / iterations;

  return { label, deltaPerOp, totalDelta, totalMemory: after, iterations };
}
