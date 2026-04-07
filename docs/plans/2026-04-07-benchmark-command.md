# Benchmark Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `ppg benchmark` command that times token issuance, single requests, and 1000 sequential requests, with optional direct-to-service mode.

**Architecture:** New `commands/benchmark/` directory in the CLI package. Reuses existing `OHTTPClient`, `PPGClient`, and `PaymentClient` without modification. A `Timer` utility records labeled phases, and a `format` module renders summary tables. `--no-relay` bypasses OHTTP by using plain `fetch()`.

**Tech Stack:** Node.js, commander.js (already used), vitest (already used), no new dependencies.

---

### Task 1: Timer Utility

**Files:**
- Create: `packages/cli/src/commands/benchmark/timer.ts`

**Step 1: Write the failing test**

Create `packages/cli/src/__tests__/benchmark-timer.test.ts`:

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/src/__tests__/benchmark-timer.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `packages/cli/src/commands/benchmark/timer.ts`:

```typescript
export interface PhaseResult {
  name: string;
  ms: number;
}

export interface TimerSnapshot {
  ms: number;
  phases: PhaseResult[];
}

export class Timer {
  private starts: Map<string, number> = new Map();
  private results: PhaseResult[] = [];

  start(name: string): void {
    if (this.starts.has(name)) {
      throw new Error(`phase "${name}" already started`);
    }
    this.starts.set(name, performance.now());
  }

  end(name: string): void {
    const start = this.starts.get(name);
    if (start === undefined) {
      throw new Error(`phase "${name}" has no matching start`);
    }
    this.starts.delete(name);
    this.results.push({ name, ms: performance.now() - start });
  }

  phases(): PhaseResult[] {
    return [...this.results];
  }

  total(): number {
    return this.results.reduce((sum, p) => sum + p.ms, 0);
  }

  snapshot(): TimerSnapshot {
    return { ms: this.total(), phases: this.phases() };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run packages/cli/src/__tests__/benchmark-timer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/cli/src/commands/benchmark/timer.ts packages/cli/src/__tests__/benchmark-timer.test.ts
git commit -m "feat(cli): add Timer utility for benchmark instrumentation"
```

---

### Task 2: Format Utility

**Files:**
- Create: `packages/cli/src/commands/benchmark/format.ts`
- Create: `packages/cli/src/__tests__/benchmark-format.test.ts`

**Step 1: Write the failing test**

Create `packages/cli/src/__tests__/benchmark-format.test.ts`:

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/src/__tests__/benchmark-format.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `packages/cli/src/commands/benchmark/format.ts`:

```typescript
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
    const idx = Math.ceil((p / 100) * count) - 1;
    return sorted[Math.max(0, Math.min(idx, count - 1))];
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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run packages/cli/src/__tests__/benchmark-format.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/cli/src/commands/benchmark/format.ts packages/cli/src/__tests__/benchmark-format.test.ts
git commit -m "feat(cli): add benchmark format utilities for summary tables"
```

---

### Task 3: Benchmark Issue Command

**Files:**
- Create: `packages/cli/src/commands/benchmark/issue.ts`

This implements `ppg benchmark issue [--iterations N] [--no-relay]`. It follows the same flow as `buy-tokens.ts` but wraps each sub-phase with `Timer` instrumentation.

**Step 1: Write the implementation**

Create `packages/cli/src/commands/benchmark/issue.ts`:

```typescript
import {
  computeTokenKeyId,
  deserializeTokenChallenge,
  hashTokenChallenge,
  uint8ArrayToBase64Url,
  base64UrlToUint8Array,
  TOKEN_COUNT,
} from "@ppg/shared";
import type { IssueRequest, IssueResponse } from "@ppg/shared";
import { PPGClient } from "../../services/client.js";
import { PaymentClient, getPaymentMode } from "../../services/payment.js";
import { OHTTPClient } from "../../services/ohttp-client.js";
import { Timer } from "./timer.js";
import { formatSummary, formatStats } from "./format.js";

const DEFAULT_FACILITATOR = "http://localhost:3002";
const DEFAULT_GATEWAY = "http://localhost:3001";

export async function benchmarkIssue(options: {
  facilitator?: string;
  gateway?: string;
  relay?: string;
  noRelay?: boolean;
  iterations?: number;
}): Promise<void> {
  const iterations = options.iterations ?? 5;
  const facilitator = options.facilitator ?? DEFAULT_FACILITATOR;
  const gateway = options.gateway ?? DEFAULT_GATEWAY;
  const relay = options.noRelay ? "" : (options.relay || "http://localhost:3000");
  const httpClient = new OHTTPClient(relay);

  const allTotals: number[] = [];
  let lastPhases: { name: string; ms: number }[] = [];

  for (let i = 0; i < iterations; i++) {
    const t = new Timer();

    t.start("fetch-keys");
    const tokenKeyResp = await httpClient.request(`${facilitator}/token-key`, {}, facilitator);
    if (!tokenKeyResp.ok) throw new Error(`Failed to get token key: ${tokenKeyResp.status}`);
    const publicKey = new Uint8Array(await tokenKeyResp.arrayBuffer());
    const keyId = computeTokenKeyId(publicKey);
    t.end("fetch-keys");

    t.start("get-challenge");
    const gatewayResp = await httpClient.request(`${gateway}/api/weather`, {}, gateway);
    if (gatewayResp.status !== 402) throw new Error(`Expected 402, got ${gatewayResp.status}`);
    const wwwAuth = gatewayResp.headers.get("WWW-Authenticate");
    if (!wwwAuth) throw new Error("Missing WWW-Authenticate header");
    const challengeB64 = wwwAuth.split("challenge=")[1]?.split(",")[0]?.replace(/"/g, "");
    if (!challengeB64) throw new Error("No challenge in WWW-Authenticate");
    const challenge = deserializeTokenChallenge(base64UrlToUint8Array(challengeB64));
    const challengeDigest = hashTokenChallenge(challenge);
    t.end("get-challenge");

    const client = new PPGClient(publicKey);

    t.start("blind");
    const { finData, evalReq } = await client.blindTokens(challengeDigest, keyId);
    t.end("blind");

    t.start("payment");
    const paymentClient = new PaymentClient();
    const mode = await getPaymentMode();
    const paymentRequiredHeader = gatewayResp.headers.get("X-Payment-Required");
    const rawRequirements = paymentRequiredHeader
      ? (() => {
          const parsed = JSON.parse(Buffer.from(paymentRequiredHeader, "base64").toString());
          const accepts = parsed.accepts || parsed;
          return Array.isArray(accepts) ? accepts[0] : accepts;
        })()
      : { scheme: "mock", network: "mock:test", asset: "MOCK", amount: "0", payTo: "test", maxTimeoutSeconds: 60, extra: {} };
    const requirements = {
      ...rawRequirements,
      maxAmountRequired: rawRequirements.amount || rawRequirements.maxAmountRequired,
      extra: { ...rawRequirements.extra, feePayer: rawRequirements.extra?.feePayer || rawRequirements.payTo },
    };
    const paymentPayload = await paymentClient.createPayment(requirements);
    t.end("payment");

    const blindedElements = evalReq.blinded.map((e) => uint8ArrayToBase64Url(e.serialize()));
    const issueRequest: IssueRequest = { paymentPayload, blindedElements };

    t.start("issue-request");
    const issueResp = await httpClient.request(`${facilitator}/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(issueRequest),
    }, facilitator);
    if (!issueResp.ok) throw new Error(`Issue request failed: ${issueResp.status}`);
    t.end("issue-request");

    const issueResponse: IssueResponse = await issueResp.json();
    const evaluatedElements = issueResponse.evaluatedElements.map((b64: string) => base64UrlToUint8Array(b64));
    const proof = base64UrlToUint8Array(issueResponse.proof);
    const { evaluatedElementsToEvaluation } = await import("@ppg/shared");
    const evaluation = evaluatedElementsToEvaluation(evaluatedElements, proof);

    t.start("finalize");
    await client.finalizeTokens(finData, evaluation);
    t.end("finalize");

    const snap = t.snapshot();
    allTotals.push(snap.ms);
    lastPhases = snap.phases;
  }

  console.log(formatSummary(lastPhases, `Token Issuance (${iterations} iterations)`));

  const stats = formatStats(allTotals);
  console.log(`  Total (mean over ${iterations}):  ${stats.mean.toFixed(1)} ms`);
  console.log(`  Total (median):          ${stats.median.toFixed(1)} ms`);
  console.log(`  Total (p95):             ${stats.p95.toFixed(1)} ms`);
  console.log("");
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p packages/cli/tsconfig.json`
Expected: no errors

**Step 3: Commit**

```bash
git add packages/cli/src/commands/benchmark/issue.ts
git commit -m "feat(cli): add benchmark issue command"
```

---

### Task 4: Benchmark Request Command

**Files:**
- Create: `packages/cli/src/commands/benchmark/request.ts`

This implements `ppg benchmark request --count <N> [--no-relay]`. Requires pre-existing tokens — fails fast if none available. Times each request individually and reports aggregate stats.

**Step 1: Write the implementation**

Create `packages/cli/src/commands/benchmark/request.ts`:

```typescript
import { encodeTokenForHeader } from "@ppg/shared";
import { OHTTPClient } from "../../services/ohttp-client.js";
import { consumeToken, getTokens } from "../../services/token-store.js";
import { Timer } from "./timer.js";
import { formatStats, formatRequestStats } from "./format.js";

const DEFAULT_GATEWAY = "http://localhost:3001";

export async function benchmarkRequest(options: {
  gateway?: string;
  relay?: string;
  noRelay?: boolean;
  count?: number;
}): Promise<void> {
  const count = options.count ?? 1;
  const gateway = options.gateway ?? DEFAULT_GATEWAY;
  const relay = options.noRelay ? "" : (options.relay || "http://localhost:3000");
  const url = `${gateway}/api/weather`;
  const httpClient = new OHTTPClient(relay);

  const available = await getTokens();
  if (available.length < count) {
    throw new Error(`Not enough tokens. Have ${available.length}, need ${count}. Run 'ppg buy-tokens' first.`);
  }

  const timings: number[] = [];

  for (let i = 0; i < count; i++) {
    const token = await consumeToken();
    if (!token) throw new Error(`Ran out of tokens at request ${i + 1}/${count}`);

    const t = new Timer();
    t.start("request");
    const resp = await httpClient.request(url, {
      headers: {
        Authorization: `PrivateToken token="${encodeTokenForHeader(token)}"`,
      },
    });
    t.end("request");

    if (resp.status !== 200) {
      throw new Error(`Request ${i + 1} failed with status ${resp.status}: ${await resp.text()}`);
    }

    timings.push(t.total());
  }

  const stats = formatStats(timings);
  const title = count === 1
    ? "Single Request"
    : `${count} Sequential Requests`;
  console.log(formatRequestStats(stats, title));
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p packages/cli/tsconfig.json`
Expected: no errors

**Step 3: Commit**

```bash
git add packages/cli/src/commands/benchmark/request.ts
git commit -m "feat(cli): add benchmark request command"
```

---

### Task 5: Benchmark Full Command

**Files:**
- Create: `packages/cli/src/commands/benchmark/full.ts`

This runs issue → single request → 1000 requests as a pipeline.

**Step 1: Write the implementation**

Create `packages/cli/src/commands/benchmark/full.ts`:

```typescript
import { benchmarkIssue } from "./issue.js";
import { benchmarkRequest } from "./request.js";

export async function benchmarkFull(options: {
  facilitator?: string;
  gateway?: string;
  relay?: string;
  noRelay?: boolean;
  iterations?: number;
}): Promise<void> {
  const start = performance.now();

  await benchmarkIssue(options);

  await benchmarkRequest({
    ...options,
    count: 1,
  });

  await benchmarkRequest({
    ...options,
    count: 1000,
  });

  const elapsed = ((performance.now() - start) / 1000).toFixed(1);
  console.log(`Full benchmark completed in ${elapsed}s`);
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p packages/cli/tsconfig.json`
Expected: no errors

**Step 3: Commit**

```bash
git add packages/cli/src/commands/benchmark/full.ts
git commit -m "feat(cli): add benchmark full pipeline command"
```

---

### Task 6: Register Benchmark Command in CLI

**Files:**
- Modify: `packages/cli/src/index.ts`

**Step 1: Add benchmark subcommand to the CLI**

In `packages/cli/src/index.ts`, add the import at the top (after line 8):

```typescript
import { benchmarkIssue } from "./commands/benchmark/issue.js";
import { benchmarkRequest } from "./commands/benchmark/request.js";
import { benchmarkFull } from "./commands/benchmark/full.js";
```

And before `program.parse()` (before line 120), add the benchmark command registration:

```typescript
program
  .command("benchmark")
  .description("Benchmark token issuance and request performance")
  .addCommand(
    new Command("issue")
      .description("Benchmark token issuance flow")
      .option("--iterations <n>", "Number of iterations", "5")
      .action(async (opts) => {
        const globalOpts = program.opts();
        try {
          await benchmarkIssue({
            facilitator: globalOpts.facilitator,
            relay: globalOpts.relay,
            iterations: parseInt(opts.iterations, 10),
          });
        } catch (err) {
          console.error(err instanceof Error ? err.message : err);
          process.exit(1);
        }
      }),
  )
  .addCommand(
    new Command("request")
      .description("Benchmark token-bearing requests")
      .option("--count <n>", "Number of requests", "1")
      .action(async (opts) => {
        const globalOpts = program.opts();
        try {
          await benchmarkRequest({
            relay: globalOpts.relay,
            count: parseInt(opts.count, 10),
          });
        } catch (err) {
          console.error(err instanceof Error ? err.message : err);
          process.exit(1);
        }
      }),
  )
  .addCommand(
    new Command("full")
      .description("Run full benchmark: issue + single request + 1000 requests")
      .action(async () => {
        const globalOpts = program.opts();
        try {
          await benchmarkFull({
            facilitator: globalOpts.facilitator,
            relay: globalOpts.relay,
          });
        } catch (err) {
          console.error(err instanceof Error ? err.message : err);
          process.exit(1);
        }
      }),
  );
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p packages/cli/tsconfig.json`
Expected: no errors

**Step 3: Verify help text**

Run: `npm run build && node packages/cli/dist/index.js benchmark --help`
Expected: shows issue, request, full subcommands

**Step 4: Run all tests**

Run: `npm test`
Expected: all pass

**Step 5: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): register benchmark subcommands in CLI"
```

---

### Task 7: Add --no-relay Flag Support

**Files:**
- Modify: `packages/cli/src/index.ts`

The `--no-relay` flag needs to be passed through to the benchmark commands. Update the benchmark subcommand actions to check for the flag.

**Step 1: Add --no-relay to benchmark parent command**

Update the benchmark command registration to include the `--no-relay` flag:

```typescript
program
  .command("benchmark")
  .description("Benchmark token issuance and request performance")
  .option("--no-relay", "Bypass OHTTP relay, hit services directly")
  .addCommand(
    new Command("issue")
      .description("Benchmark token issuance flow")
      .option("--iterations <n>", "Number of iterations", "5")
      .action(async (opts) => {
        const globalOpts = program.opts();
        const benchOpts = program.commands.find((c) => c.name() === "benchmark")!.opts();
        try {
          await benchmarkIssue({
            facilitator: globalOpts.facilitator,
            relay: globalOpts.relay,
            noRelay: benchOpts.noRelay,
            iterations: parseInt(opts.iterations, 10),
          });
        } catch (err) {
          console.error(err instanceof Error ? err.message : err);
          process.exit(1);
        }
      }),
  )
  .addCommand(
    new Command("request")
      .description("Benchmark token-bearing requests")
      .option("--count <n>", "Number of requests", "1")
      .action(async (opts) => {
        const globalOpts = program.opts();
        const benchOpts = program.commands.find((c) => c.name() === "benchmark")!.opts();
        try {
          await benchmarkRequest({
            relay: globalOpts.relay,
            noRelay: benchOpts.noRelay,
            count: parseInt(opts.count, 10),
          });
        } catch (err) {
          console.error(err instanceof Error ? err.message : err);
          process.exit(1);
        }
      }),
  )
  .addCommand(
    new Command("full")
      .description("Run full benchmark: issue + single request + 1000 requests")
      .action(async () => {
        const globalOpts = program.opts();
        const benchOpts = program.commands.find((c) => c.name() === "benchmark")!.opts();
        try {
          await benchmarkFull({
            facilitator: globalOpts.facilitator,
            relay: globalOpts.relay,
            noRelay: benchOpts.noRelay,
          });
        } catch (err) {
          console.error(err instanceof Error ? err.message : err);
          process.exit(1);
        }
      }),
  );
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p packages/cli/tsconfig.json`
Expected: no errors

**Step 3: Verify help text**

Run: `node packages/cli/dist/index.js benchmark --help`
Expected: shows `--no-relay` option

**Step 4: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): add --no-relay flag to benchmark commands"
```

---

### Task 8: Integration Smoke Test

**Files:**
- Modify: `packages/cli/src/__tests__/cli.test.ts`

**Step 1: Add benchmark command registration test**

Add to the existing `describe("CLI help text")` block:

```typescript
it("benchmark command is registered", () => {
  const program = new Command();
  program.name("ppg");
  program.command("benchmark").description("Benchmark token issuance and request performance");
  const benchCmd = program.commands.find((c) => c.name() === "benchmark");
  expect(benchCmd).toBeDefined();
});
```

**Step 2: Run all tests**

Run: `npm test`
Expected: all pass

**Step 3: Commit**

```bash
git add packages/cli/src/__tests__/cli.test.ts
git commit -m "test(cli): add benchmark command registration test"
```

---

### Task 9: Build and Verify End-to-End

**Step 1: Build the project**

Run: `npm run build`
Expected: clean build with no errors

**Step 2: Verify all subcommands**

```bash
node packages/cli/dist/index.js benchmark --help
node packages/cli/dist/index.js benchmark issue --help
node packages/cli/dist/index.js benchmark request --help
node packages/cli/dist/index.js benchmark full --help
```

Expected: all show proper help text with options

**Step 3: Run full test suite**

Run: `npm test`
Expected: all pass

**Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors
