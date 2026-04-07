import {
  computeTokenKeyId,
  deserializeTokenChallenge,
  hashTokenChallenge,
  uint8ArrayToBase64Url,
  base64UrlToUint8Array,
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
