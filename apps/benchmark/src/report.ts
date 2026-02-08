import type { Task } from "tinybench";
import type { MemoryResult } from "./types.js";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

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

function nsFromMs(ms: number): number {
  return ms * 1_000_000;
}

// ---------------------------------------------------------------------------
// Box-drawing table
// ---------------------------------------------------------------------------

function drawTable(headers: string[], rows: string[][], colWidths: number[]): string {
  const top = `┌${colWidths.map((w) => "─".repeat(w + 2)).join("┬")}┐`;
  const mid = `├${colWidths.map((w) => "─".repeat(w + 2)).join("┼")}┤`;
  const bot = `└${colWidths.map((w) => "─".repeat(w + 2)).join("┴")}┘`;

  const headerRow = `│${headers.map((h, i) => ` ${padRight(h, colWidths[i]!)} `).join("│")}│`;

  const dataRows = rows.map(
    (row) =>
      "│" +
      row
        .map((cell, i) => {
          // Right-align numeric columns (all except first)
          return i === 0 ? ` ${padRight(cell, colWidths[i]!)} ` : ` ${padLeft(cell, colWidths[i]!)} `;
        })
        .join("│") +
      "│"
  );

  return [top, headerRow, mid, ...dataRows, bot].join("\n");
}

// ---------------------------------------------------------------------------
// Throughput report
// ---------------------------------------------------------------------------

export function printThroughputReport(suiteName: string, presetName: string, tasks: Task[], libName: string): void {
  const headers = ["Benchmark", "ops/sec", "ops/frame", "avg", "P75", "P99"];
  const rows: string[][] = [];

  // Nanoseconds in one frame at 60 fps
  const nsPerFrame = 1_000_000_000 / 60;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]!;
    const result = task.result;
    if (result.state !== "completed") {
      rows.push([task.name, "—", "—", "—", "—", "—"]);
      continue;
    }
    const { latency } = result;
    const meanNs = nsFromMs(latency.mean);
    const opsPerSec = meanNs > 0 ? formatNumber(Math.round(1_000_000_000 / meanNs)) : "—";
    const opsPerFrame = meanNs > 0 ? formatNumber(Math.round(nsPerFrame / meanNs)) : "—";
    const avg = meanNs > 0 ? formatTime(meanNs) : "—";
    const p75 = formatTime(nsFromMs(latency.p75));
    const p99 = formatTime(nsFromMs(latency.p99));
    rows.push([task.name, opsPerSec, opsPerFrame, avg, p75, p99]);
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

// ---------------------------------------------------------------------------
// Memory report
// ---------------------------------------------------------------------------

export function printMemoryReport(
  suiteName: string,
  presetName: string,
  results: MemoryResult[],
  libName: string
): void {
  const headers = ["Benchmark", "delta/op", "total delta", "total mem"];
  const rows: string[][] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    rows.push([r.label, formatDelta(r.deltaPerOp), formatDelta(r.totalDelta), formatBytes(r.totalMemory)]);
  }

  const colWidths = headers.map((h, i) => {
    let max = h.length;
    for (let r = 0; r < rows.length; r++) {
      max = Math.max(max, rows[r]![i]!.length);
    }
    return max;
  });

  console.log(`\n${suiteName} — ${presetName} world (${libName}, memory)`);
  console.log(drawTable(headers, rows, colWidths));
}
