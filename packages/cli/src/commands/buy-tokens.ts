import {
  computeTokenKeyId,
  deserializeTokenChallenge,
  hashTokenChallenge,
  uint8ArrayToBase64Url,
  base64UrlToUint8Array,
  TOKEN_COUNT,
} from "@ppg/shared";
import type { IssueRequest, IssueResponse } from "@ppg/shared";
import { PPGClient } from "../services/client.js";
import { PaymentClient, getPaymentMode } from "../services/payment.js";
import { OHTTPClient } from "../services/ohttp-client.js";
import { storeTokens } from "../services/token-store.js";

const DEFAULT_FACILITATOR = "http://localhost:3002";
const DEFAULT_GATEWAY = "http://localhost:3001";

export async function buyTokensAction(options: {
  facilitator?: string;
  gateway?: string;
  relay?: string;
}): Promise<number> {
  const facilitator = options.facilitator ?? DEFAULT_FACILITATOR;
  const gateway = options.gateway ?? DEFAULT_GATEWAY;
  const httpClient = new OHTTPClient(options.relay);

  const tokenKeyResp = await httpClient.request(`${facilitator}/token-key`, {}, facilitator);
  if (!tokenKeyResp.ok) {
    throw new Error(`Failed to get token key: ${tokenKeyResp.status}`);
  }
  const publicKey = new Uint8Array(await tokenKeyResp.arrayBuffer());
  if (publicKey.length !== 32) {
    throw new Error(`Expected 32-byte Ristretto255 public key, got ${publicKey.length}`);
  }
  const keyId = computeTokenKeyId(publicKey);

  const gatewayResp = await httpClient.request(`${gateway}/api/weather`, {}, gateway);
  if (gatewayResp.status !== 402) {
    throw new Error(`Expected 402 from gateway, got ${gatewayResp.status}`);
  }

  const wwwAuth = gatewayResp.headers.get("WWW-Authenticate");
  if (!wwwAuth) throw new Error("Missing WWW-Authenticate header");

  const challengeB64 = wwwAuth.split("challenge=")[1]?.split(",")[0]?.replace(/"/g, "");
  if (!challengeB64) throw new Error("No challenge in WWW-Authenticate");
  const challenge = deserializeTokenChallenge(base64UrlToUint8Array(challengeB64));
  const challengeDigest = hashTokenChallenge(challenge);

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
    extra: {
      ...rawRequirements.extra,
      feePayer: rawRequirements.extra?.feePayer || rawRequirements.payTo,
    },
  };

  const client = new PPGClient(publicKey);
  const { finData, evalReq } = await client.blindTokens(challengeDigest, keyId);

  const mode = await getPaymentMode();
  if (mode.mock) {
    console.warn("Warning: paying in mock mode. Set PPG_SOLANA_PRIVATE_KEY to use real payments.");
  } else {
    console.warn(`Paying on Solana ${mode.network}`);
  }

  const blindedElements = evalReq.blinded.map((e) =>
    uint8ArrayToBase64Url(e.serialize()),
  );

  const paymentClient = new PaymentClient();

  const issueRequest: IssueRequest = {
    paymentPayload: await paymentClient.createPayment(requirements),
    blindedElements,
  };

  if (blindedElements.length !== TOKEN_COUNT) {
    throw new Error(`Expected ${TOKEN_COUNT} blinded elements, got ${blindedElements.length}`);
  }

  const issueResp = await httpClient.request(`${facilitator}/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(issueRequest),
  }, facilitator);

  if (!issueResp.ok) {
    throw new Error(`Issue request failed: ${issueResp.status} ${await issueResp.text()}`);
  }

  const issueResponse: IssueResponse = await issueResp.json();
  const evaluatedElements = issueResponse.evaluatedElements.map((b64: string) =>
    base64UrlToUint8Array(b64),
  );
  const proof = base64UrlToUint8Array(issueResponse.proof);

  const { evaluatedElementsToEvaluation } = await import("@ppg/shared");
  const evaluation = evaluatedElementsToEvaluation(evaluatedElements, proof);

  const tokens = await client.finalizeTokens(finData, evaluation);
  await storeTokens(tokens);

  if (issueResponse.settlement?.transaction && !issueResponse.settlement.transaction.startsWith("mock")) {
    console.warn(`Transaction: https://orbmarkets.io/?cluster=devnet&tx=${issueResponse.settlement.transaction}`);
  }

  return tokens.length;
}
