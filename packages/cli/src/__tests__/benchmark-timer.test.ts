import { describe, it, expect } from "vitest";
import { Timer } from "../commands/benchmark/timer.js";

describe("Timer", () => {
  it("records a single phase", async () => {
    const t = new Timer();
    t.start("work");
    await new Promise((r) => setTimeout(r, 10));
    t.end("work");
    const phases = t.phases();
    expect(phases).toHaveLength(1);
    expect(phases[0].name).toBe("work");
    expect(phases[0].ms).toBeGreaterThanOrEqual(10);
  });

  it("records multiple phases", () => {
    const t = new Timer();
    t.start("a");
    t.end("a");
    t.start("b");
    t.end("b");
    expect(t.phases()).toHaveLength(2);
    expect(t.phases()[0].name).toBe("a");
    expect(t.phases()[1].name).toBe("b");
  });

  it("throws on end without matching start", () => {
    const t = new Timer();
    expect(() => t.end("missing")).toThrow("no matching start");
  });

  it("throws on duplicate start", () => {
    const t = new Timer();
    t.start("dup");
    expect(() => t.start("dup")).toThrow("already started");
  });

  it("total returns sum of all phases", async () => {
    const t = new Timer();
    t.start("a");
    t.end("a");
    t.start("b");
    await new Promise((r) => setTimeout(r, 5));
    t.end("b");
    expect(t.total()).toBeGreaterThanOrEqual(5);
  });

  it("snapshot captures current total", async () => {
    const t = new Timer();
    t.start("a");
    t.end("a");
    const snap = t.snapshot();
    expect(snap.ms).toBeGreaterThanOrEqual(0);
    expect(snap.phases).toHaveLength(1);
  });
});
