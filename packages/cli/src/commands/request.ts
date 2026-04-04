import {
  computeTokenKeyId,
  deserializeTokenChallenge,
  hashTokenChallenge,
  base64UrlToUint8Array,
  uint8ArrayToBase64Url,
  encodeTokenForHeader,
  blindedElementsToEvalReq,
  evaluatedElementsToEvaluation,
} from "@ppg/shared";
import type { TokenChallenge, IssueRequest, IssueResponse, PaymentRequirements } from "@ppg/shared";
import { PPGClient } from "../services/client.js";
import { PaymentClient, getPaymentMode } from "../services/payment.js";
import { OHTTPClient } from "../services/ohttp-client.js";
import { consumeToken, getTokens, storeTokens } from "../services/token-store.js";

const DEFAULT_FACILITATOR = "http://localhost:3002";

export async function requestAction(
  url: string,
  options: { facilitator?: string; relay?: string; autoPurchase?: boolean },
): Promise<string> {
  const facilitator = options.facilitator ?? DEFAULT_FACILITATOR;
  const httpClient = new OHTTPClient(options.relay);

  const existingTokens = await getTokens();
  if (existingTokens.length > 0) {
    const token = await consumeToken();
    if (token) {
      const resp = await httpClient.request(url, {
        headers: {
          Authorization: `PrivateToken token="${encodeTokenForHeader(token)}"`,
        },
      });
      if (resp.status === 200) {
        return resp.text();
      }
    }
  }

  const unauthResp = await httpClient.request(url, {});
  if (unauthResp.status === 402) {
    if (options.autoPurchase) {
      return autoPurchaseAndRetry(url, facilitator, httpClient, unauthResp);
    }
    throw new Error(
      `Payment required. Run 'private-pay buy-tokens --gateway ${url.replace(/\/api\/.*$/, "")}' first, or use --auto-purchase to buy tokens automatically.`,
    );
  }

  return unauthResp.text();
}

async function autoPurchaseAndRetry(
  url: string,
  facilitator: string,
  httpClient: OHTTPClient,
  firstResp: Response,
): Promise<string> {
  const wwwAuth = firstResp.headers.get("WWW-Authenticate");
  if (!wwwAuth) throw new Error("Missing WWW-Authenticate header");
  const { challenge, tokenKey } = parseWWWAuthenticate(wwwAuth);

  const requirements = await fetchRequirementsOHTTP(url, httpClient);

  const tokenKeyResp = await httpClient.request(`${facilitator}/token-key`, {}, facilitator);
  if (!tokenKeyResp.ok) {
    throw new Error(`Failed to get token key: ${tokenKeyResp.status}`);
  }
  const publicKey = new Uint8Array(await tokenKeyResp.arrayBuffer());
  const keyId = computeTokenKeyId(publicKey);

  const client = new PPGClient(publicKey);
  const challengeDigest = hashTokenChallenge(challenge);

  const { finData, evalReq } = await client.blindTokens(challengeDigest, keyId);
  const blindedElements = evalReq.blinded.map((e) =>
    uint8ArrayToBase64Url(e.serialize()),
  );

  const paymentClient = new PaymentClient();
  const mode = await getPaymentMode();
  if (mode.mock) {
    console.warn("Warning: paying in mock mode. No payment key found.");
  } else {
    console.warn(`Paying on Solana ${mode.network}`);
  }
  const paymentPayload = await paymentClient.createPayment(requirements);

  const issueRequest: IssueRequest = {
    paymentPayload,
    blindedElements,
  };

  const issueResp = await httpClient.request(`${facilitator}/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(issueRequest),
  }, facilitator);

  if (!issueResp.ok) {
    throw new Error(`Issue request failed: ${issueResp.status} ${await issueResp.text()}`);
  }

  const issueResponse: IssueResponse = await issueResp.json();
  const evaluatedElementsB64 = issueResponse.evaluatedElements;
  const proofB64 = issueResponse.proof;
  const evaluatedElements = evaluatedElementsB64.map((b64) => base64UrlToUint8Array(b64));
  const proof = base64UrlToUint8Array(proofB64);
  const evaluation = evaluatedElementsToEvaluation(evaluatedElements, proof);

  const tokens = await client.finalizeTokens(finData, evaluation);
  await storeTokens(tokens);

  const token = await consumeToken();
  if (!token) throw new Error("Failed to get token after issuance");

  const resp = await httpClient.request(url, {
    headers: {
      Authorization: `PrivateToken token="${encodeTokenForHeader(token)}"`,
    },
  });

  return resp.text();
}

async function fetchRequirementsOHTTP(
  url: string,
  httpClient: OHTTPClient,
): Promise<PaymentRequirements> {
  const resp = await httpClient.request(url, {});
  const paymentRequired = resp.headers.get("X-Payment-Required");
  if (!paymentRequired) {
    throw new Error(
      `Missing X-Payment-Required header in 402 response. Status was ${resp.status}.`,
    );
  }
  const parsed = JSON.parse(Buffer.from(paymentRequired, "base64").toString());
  const accepts = parsed.accepts || parsed;
  const raw = Array.isArray(accepts) ? accepts[0] : accepts;
  return {
    ...raw,
    maxAmountRequired: raw.amount || raw.maxAmountRequired,
    extra: {
      ...raw.extra,
      feePayer: raw.extra?.feePayer || raw.payTo,
    },
  };
}

function parseWWWAuthenticate(header: string): {
  challenge: TokenChallenge;
  tokenKey: string;
} {
  const stripped = header.replace(/^PrivateToken\s+/, "");
  const parts = stripped.split(",");
  let challengeB64 = "";
  let tokenKey = "";

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith("challenge=")) {
      challengeB64 = trimmed.slice("challenge=".length).replace(/"/g, "");
    } else if (trimmed.startsWith("token-key=")) {
      tokenKey = trimmed.slice("token-key=".length).replace(/"/g, "");
    }
  }

  if (!challengeB64 || !tokenKey) {
    throw new Error(`Invalid WWW-Authenticate header: ${header}`);
  }

  const challenge = deserializeTokenChallenge(base64UrlToUint8Array(challengeB64));
  return { challenge, tokenKey };
}
