import type { Task } from "tinybench";
import type { MemoryResult } from "./types.js";

// ============================================================================
// Formatting helpers
// ============================================================================

function padRight(str: string, len: number): string {
  return str + " ".repeat(Math.max(0, len - str.length));
}

function padLeft(str: string, len: number): string {
  return " ".repeat(Math.max(0, len - str.length)) + str;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Formats a signed byte delta with sign prefix and auto-scaled units. */
function formatDelta(n: number): string {
  const sign = n < 0 ? "-" : "+";
  const abs = Math.abs(n);
  if (abs < 1024) return `${sign}${formatNumber(Math.round(abs))} B`;
  if (abs < 1024 * 1024) return `${sign}${(abs / 1024).toFixed(1)} KB`;
  return `${sign}${(abs / (1024 * 1024)).toFixed(1)} MB`;
}

/** Formats an absolute byte count with auto-scaled units. */
function formatBytes(n: number): string {
  if (n < 1024) return `${formatNumber(Math.round(n))} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(ns: number): string {
  if (ns < 1_000) return `${formatNumber(Math.round(ns))} ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)} µs`;
  return `${(ns / 1_000_000).toFixed(2)} ms`;
}

function formatLargeNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} K`;
  return formatNumber(Math.round(n));
}

function nsFromMs(ms: number): number {
  return ms * 1_000_000;
}

// ============================================================================
// Box-drawing table
// ============================================================================

function drawTable(headers: string[], rows: string[][], colWidths: number[], leftAlignCols?: Set<number>): string {
  const top = `┌${colWidths.map((w) => "─".repeat(w + 2)).join("┬")}┐`;
  const mid = `├${colWidths.map((w) => "─".repeat(w + 2)).join("┼")}┤`;
  const bot = `└${colWidths.map((w) => "─".repeat(w + 2)).join("┴")}┘`;

  const headerRow = `│${headers.map((h, i) => ` ${padRight(h, colWidths[i]!)} `).join("│")}│`;

  const dataRows = rows.map(
    (row) =>
      "│" +
      row
        .map((cell, i) => {
          // Left-align first column and any explicitly marked columns
          const left = i === 0 || leftAlignCols?.has(i);
          return left ? ` ${padRight(cell, colWidths[i]!)} ` : ` ${padLeft(cell, colWidths[i]!)} `;
        })
        .join("│") +
      "│"
  );

  return [top, headerRow, mid, ...dataRows, bot].join("\n");
}

// ============================================================================
// Throughput report
// ============================================================================

export function printThroughputReport(
  suiteName: string,
  presetName: string,
  tasks: Task[],
  libName: string,
  entityCounts?: Map<string, number>
): void {
  const hasEntCols = entityCounts != null && entityCounts.size > 0;
  const headers = hasEntCols
    ? ["Benchmark", "ops/sec", "ops/frame", "ent/sec", "ent/frame", "avg", "P75", "P99"]
    : ["Benchmark", "ops/sec", "ops/frame", "avg", "P75", "P99"];
  const rows: string[][] = [];

  // Nanoseconds in one frame at 60 fps
  const nsPerFrame = 1_000_000_000 / 60;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]!;
    const result = task.result;
    if (result.state !== "completed") {
      const row = Array.from({ length: headers.length }, () => "—");
      row[0] = task.name;
      rows.push(row);
      continue;
    }
    const { latency } = result;
    const meanNs = nsFromMs(latency.mean);
    const rawOpsPerSec = meanNs > 0 ? 1_000_000_000 / meanNs : 0;
    const rawOpsPerFrame = meanNs > 0 ? nsPerFrame / meanNs : 0;
    const opsPerSec = rawOpsPerSec > 0 ? formatNumber(Math.round(rawOpsPerSec)) : "—";
    const opsPerFrame = rawOpsPerFrame > 0 ? formatNumber(Math.round(rawOpsPerFrame)) : "—";
    const avg = meanNs > 0 ? formatTime(meanNs) : "—";
    const p75 = formatTime(nsFromMs(latency.p75));
    const p99 = formatTime(nsFromMs(latency.p99));

    if (hasEntCols) {
      const entCount = entityCounts!.get(task.name);
      const entPerSec = entCount != null && rawOpsPerSec > 0 ? formatLargeNumber(rawOpsPerSec * entCount) : "—";
      const entPerFrame =
        entCount != null && rawOpsPerFrame > 0 ? formatNumber(Math.round(rawOpsPerFrame * entCount)) : "—";
      rows.push([task.name, opsPerSec, opsPerFrame, entPerSec, entPerFrame, avg, p75, p99]);
    } else {
      rows.push([task.name, opsPerSec, opsPerFrame, avg, p75, p99]);
    }
  }

  const colWidths = headers.map((h, i) => {
    let max = h.length;
    for (let r = 0; r < rows.length; r++) {
      max = Math.max(max, rows[r]![i]!.length);
    }
    return max;
  });

  console.log(`\n${suiteName} — ${presetName} world (${libName})`);
  console.log(drawTable(headers, rows, colWidths));
}

// ============================================================================
// ASCII histogram
// ============================================================================

const HIST_BLOCKS = " ▁▂▃▄▅▆▇█";
const HIST_WIDTH = 20;

/**
 * Render an ASCII histogram from sorted positive deltas.
 * Uses ~20 character-width bins with Unicode block characters.
 * Range is capped at P99 so extreme outliers don't flatten the distribution
 * (the min/max columns show the full range). Returns empty string if no data.
 */
function renderHistogram(posDeltas: number[]): string {
  if (posDeltas.length === 0) return "";

  const min = posDeltas[0]!;

  // Cap range at P99 to keep distribution visible
  const p99Idx = Math.min(Math.ceil(posDeltas.length * 0.99) - 1, posDeltas.length - 1);
  const cap = posDeltas[p99Idx]!;

  if (min === cap) {
    return HIST_BLOCKS[8]!.repeat(Math.min(posDeltas.length, HIST_WIDTH));
  }

  const bins = new Array<number>(HIST_WIDTH).fill(0);
  const range = cap - min;

  for (let i = 0; i < posDeltas.length; i++) {
    const binIdx = Math.min(Math.floor(((posDeltas[i]! - min) / range) * HIST_WIDTH), HIST_WIDTH - 1);
    bins[binIdx] = bins[binIdx]! + 1;
  }

  let maxCount = 0;
  for (let i = 0; i < bins.length; i++) {
    if (bins[i]! > maxCount) maxCount = bins[i]!;
  }

  let result = "";
  for (let i = 0; i < bins.length; i++) {
    const level = maxCount > 0 ? Math.round((bins[i]! / maxCount) * 8) : 0;
    result += HIST_BLOCKS[level]!;
  }

  return result.replace(/ +$/, "");
}

// ============================================================================
// Memory report
// ============================================================================

export function printMemoryReport(
  suiteName: string,
  presetName: string,
  results: MemoryResult[],
  libName: string
): void {
  const headers = ["Benchmark", "alloc/op", "min", "max", "retained", "distribution"];
  const rows: string[][] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    rows.push([
      r.label,
      formatBytes(r.allocPerOp),
      formatBytes(r.allocMin),
      formatBytes(r.allocMax),
      formatDelta(r.retained),
      renderHistogram(r.posDeltas),
    ]);
  }

  const colWidths = headers.map((h, i) => {
    let max = h.length;
    for (let r = 0; r < rows.length; r++) {
      max = Math.max(max, rows[r]![i]!.length);
    }
    return max;
  });

  const distCol = headers.indexOf("distribution");

  console.log(`\n${suiteName} — ${presetName} world (${libName}, memory)`);
  console.log(drawTable(headers, rows, colWidths, new Set([distCol])));
}
