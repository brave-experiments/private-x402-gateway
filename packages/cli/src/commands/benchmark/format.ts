import type { PhaseResult } from "./timer.js";

export interface Stats {
  count: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
}

export function formatStats(values: number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / count;
  const percentile = (p: number) => {
    const idx = (p / 100) * (count - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper || count === 1) return sorted[Math.min(lower, count - 1)];
    const frac = idx - lower;
    return sorted[lower] + frac * (sorted[upper] - sorted[lower]);
  };
  return {
    count,
    mean: Math.round(mean * 100) / 100,
    median: percentile(50),
    p95: percentile(95),
    p99: percentile(99),
    min: sorted[0],
    max: sorted[count - 1],
  };
}

export function formatSummary(phases: PhaseResult[], title: string): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`=== ${title} ===`);
  lines.push("");

  const col1 = 24;
  const col2 = 12;

  for (const phase of phases) {
    lines.push(`  ${phase.name.padEnd(col1)} ${phase.ms.toFixed(1).padStart(col2)} ms`);
  }

  const total = phases.reduce((s, p) => s + p.ms, 0);
  lines.push(`  ${"─".repeat(col1)} ${"─".repeat(col2)}`);
  lines.push(`  ${"Total".padEnd(col1)} ${total.toFixed(1).padStart(col2)} ms`);
  lines.push("");

  return lines.join("\n");
}

export function formatRequestStats(stats: Stats, title: string): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`=== ${title} ===`);
  lines.push("");
  lines.push(`  Requests:        ${stats.count}`);
  lines.push(`  Mean:            ${stats.mean.toFixed(1)} ms`);
  lines.push(`  Median:          ${stats.median.toFixed(1)} ms`);
  lines.push(`  P95:             ${stats.p95.toFixed(1)} ms`);
  lines.push(`  P99:             ${stats.p99.toFixed(1)} ms`);
  lines.push(`  Min:             ${stats.min.toFixed(1)} ms`);
  lines.push(`  Max:             ${stats.max.toFixed(1)} ms`);
  lines.push(`  Throughput:      ${(1000 / (stats.mean)).toFixed(1)} req/s`);
  lines.push("");
  return lines.join("\n");
}
