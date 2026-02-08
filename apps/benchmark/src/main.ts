import { Bench } from "tinybench";

import { iris } from "./libs/iris/index.js";
import type { LibraryAdapter } from "./libs/types.js";
import { measureMemory } from "./memory.js";
import { printMemoryReport, printThroughputReport } from "./report.js";
import type { BenchmarkDef, MemoryResult, PresetName, Suite } from "./types.js";

// ---------------------------------------------------------------------------
// Library adapters — add new libraries here
// ---------------------------------------------------------------------------

const allAdapters: LibraryAdapter[] = [iris];

// ---------------------------------------------------------------------------
// Benchmark runtime settings
// ---------------------------------------------------------------------------

/**
 * time/warmupTime are set to 0 to disable tinybench's time-based mode, which
 * keeps running iterations until a wall-clock budget is met. With expensive
 * setup or accumulating state (entity creation), that leads to unbounded
 * iteration counts. Fixed iterations give predictable, comparable runs.
 */
const THROUGHPUT_CONFIG = {
  time: 0,
  warmupTime: 0,
  warmupIterations: 1024,
  iterations: 8192,
};

const MEMORY_ITERATIONS = 2048;

/**
 * Heap measurements are inherently noisy. We take multiple independent samples
 * (each on a fresh world) and report the median to reduce outlier influence.
 */
const MEMORY_SAMPLES = 8;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const memoryMode = args.includes("--memory");

const libFlagIdx = args.indexOf("--lib");
const libFlag = libFlagIdx !== -1 ? args[libFlagIdx + 1] : undefined;

const adapters = filterAdapters(allAdapters, libFlag);
const suiteFilter = args.find((a) => !a.startsWith("--") && a !== libFlag);

function filterAdapters(all: LibraryAdapter[], flag: string | undefined): LibraryAdapter[] {
  if (flag === "all") return all;
  if (!flag) return [all[0]!];
  const adapter = all.find((a) => a.name === flag);
  if (!adapter) {
    const names = all.map((a) => a.name).join(", ");
    console.error(`Unknown library "${flag}". Available: ${names}, all`);
    process.exit(1);
  }
  return [adapter];
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function groupBenchmarksByPreset(benchmarks: BenchmarkDef[]): Map<PresetName, BenchmarkDef[]> {
  const byPreset = new Map<PresetName, BenchmarkDef[]>();
  for (let i = 0; i < benchmarks.length; i++) {
    const bench = benchmarks[i]!;
    for (let j = 0; j < bench.presets.length; j++) {
      const preset = bench.presets[j]!;
      let list = byPreset.get(preset);
      if (!list) {
        list = [];
        byPreset.set(preset, list);
      }
      list.push(bench);
    }
  }
  return byPreset;
}

function pickMedianMemoryResult(samples: MemoryResult[]): MemoryResult {
  const sorted = [...samples].sort((a, b) => a.deltaPerOp - b.deltaPerOp);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function runThroughput(adapter: LibraryAdapter, suite: Suite): Promise<void> {
  const byPreset = groupBenchmarksByPreset(suite.benchmarks);
  const { teardown } = adapter;

  for (const [presetName, benchmarks] of byPreset) {
    const factory = adapter.presets[presetName];
    const bench = new Bench(THROUGHPUT_CONFIG);

    for (let i = 0; i < benchmarks.length; i++) {
      const def = benchmarks[i]!;
      // Lazy init — only one world at a time (some libraries limit concurrent worlds)
      // biome-ignore lint/suspicious/noExplicitAny: world type varies per library
      let world: any;

      bench.add(
        def.name,
        () => {
          def.fn(world);
        },
        {
          beforeAll() {
            world = factory();
            def.setup?.(world);
          },
          // Entities accumulate across iterations intentionally — creating a
          // fresh world per iteration is prohibitively expensive and adds GC noise.
          afterAll() {
            teardown?.(world);
          },
        }
      );
    }

    await bench.run();
    printThroughputReport(suite.name, presetName, bench.tasks, adapter.name);
  }
}

function runMemory(adapter: LibraryAdapter, suite: Suite): void {
  const byPreset = groupBenchmarksByPreset(suite.benchmarks);
  const { teardown } = adapter;

  for (const [presetName, benchmarks] of byPreset) {
    const factory = adapter.presets[presetName];
    const results: MemoryResult[] = [];

    for (let i = 0; i < benchmarks.length; i++) {
      const def = benchmarks[i]!;
      const samples: MemoryResult[] = [];

      for (let sample = 0; sample < MEMORY_SAMPLES; sample++) {
        const world = factory();
        def.setup?.(world);

        const sampleResult = measureMemory(def.name, MEMORY_ITERATIONS, () => {
          def.fn(world);
        });
        samples.push(sampleResult);
        teardown?.(world);
      }

      results.push(pickMedianMemoryResult(samples));
    }

    printMemoryReport(suite.name, presetName, results, adapter.name);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const mode = memoryMode ? "memory" : "throughput";
  const libNames = adapters.map((a) => a.name).join(", ");
  console.log(`Running in ${mode} mode for: ${libNames}\n`);

  for (let a = 0; a < adapters.length; a++) {
    const adapter = adapters[a]!;
    const suites = suiteFilter
      ? adapter.suites.filter((s) => s.name.toLowerCase() === suiteFilter.toLowerCase())
      : adapter.suites;

    if (suites.length === 0) {
      const names = adapter.suites.map((s) => s.name.toLowerCase()).join(", ");
      console.error(`No suite found matching "${suiteFilter}" in ${adapter.name}. Available: ${names}`);
      continue;
    }

    for (let i = 0; i < suites.length; i++) {
      const suite = suites[i]!;
      if (memoryMode) {
        runMemory(adapter, suite);
      } else {
        await runThroughput(adapter, suite);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
