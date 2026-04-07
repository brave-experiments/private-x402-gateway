import { describe, it, expect } from "vitest";
import { formatSummary, formatStats } from "../commands/benchmark/format.js";
import type { PhaseResult } from "../commands/benchmark/timer.js";

describe("formatStats", () => {
  it("computes stats from an array of numbers", () => {
    const stats = formatStats([100, 200, 300, 400, 500]);
    expect(stats.count).toBe(5);
    expect(stats.mean).toBe(300);
    expect(stats.median).toBe(300);
    expect(stats.p95).toBe(480);
    expect(stats.p99).toBe(496);
    expect(stats.min).toBe(100);
    expect(stats.max).toBe(500);
  });

  it("handles single value", () => {
    const stats = formatStats([42]);
    expect(stats.count).toBe(1);
    expect(stats.mean).toBe(42);
    expect(stats.median).toBe(42);
    expect(stats.p95).toBe(42);
    expect(stats.p99).toBe(42);
    expect(stats.min).toBe(42);
    expect(stats.max).toBe(42);
  });
});

describe("formatSummary", () => {
  it("formats phase results into a table string", () => {
    const phases: PhaseResult[] = [
      { name: "blind", ms: 5.5 },
      { name: "relay", ms: 120.3 },
      { name: "finalize", ms: 3.2 },
    ];
    const output = formatSummary(phases, "Token Issuance");
    expect(output).toContain("Token Issuance");
    expect(output).toContain("blind");
    expect(output).toContain("relay");
    expect(output).toContain("finalize");
    expect(output).toContain("Total");
  });
});
