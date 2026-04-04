import { describe, it, expect, beforeAll } from "vitest";
import http from "node:http";
import {
  voprfKeyGen,
  createVOPRFClient,
  createVOPRFServer,
  batchBlind,
  batchIssue,
  batchFinalize,
  createTokenChallenge,
  hashTokenChallenge,
  buildTokenInput,
  uint8ArrayToBase64Url,
  encodeTokenForHeader,
  createToken,
  generateNonce,
} from "@ppg/shared";
import type { VOPRFServer } from "@cloudflare/voprf-ts";
import type { Token } from "@ppg/shared";
import { createApp } from "../index.js";
import type { Express } from "express";

let app: Express;
let server: VOPRFServer;
let publicKey: Uint8Array;

function request(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "GET", headers },
      (resp) => {
        let data = "";
        resp.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        resp.on("end", () => {
          let body: any;
          try { body = JSON.parse(data); } catch { body = data; }
          resolve({ status: resp.statusCode!, headers: resp.headers, body });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

let testServer: http.Server;
let port: number;

async function createValidToken(): Promise<{ token: Token; authHeader: string }> {
  const client = createVOPRFClient(publicKey);
  const nonce = generateNonce();
  const challenge = createTokenChallenge("gateway");
  const challengeDigest = hashTokenChallenge(challenge);
  const keyId = crypto.getRandomValues(new Uint8Array(32));

  const tokenInput = buildTokenInput(nonce, challengeDigest, keyId);
  const { finData, evalReq } = await batchBlind(client, [tokenInput]);
  const evaluation = await batchIssue(server, evalReq);
  const outputs = await batchFinalize(client, finData, evaluation);

  const token = createToken(nonce, challengeDigest, keyId, outputs[0]);
  return {
    token,
    authHeader: `PrivateToken token="${encodeTokenForHeader(token)}"`,
  };
}

beforeAll(async () => {
  const { privateKey, publicKey: pub } = await voprfKeyGen();
  server = createVOPRFServer(privateKey);
  publicKey = pub;

  const result = await createApp();
  app = result.app;
  result.verifier["server"] = server;
  result.keyManager.voprfPublicKey = pub;
  result.keyManager.voprfPrivateKey = privateKey;

  testServer = app.listen(0, () => {
    const addr = testServer.address();
    port = typeof addr === "string" ? parseInt(addr) : (addr?.port ?? 0);
  });

  await new Promise<void>((resolve) => testServer.once("listening", resolve));
});

describe("GET /api/weather without auth", () => {
  it("should return 402 with correct headers", async () => {
    const res = await request(port!, "/api/weather");

    expect(res.status).toBe(402);
    expect(res.headers["www-authenticate"]).toContain("PrivateToken");
    expect(res.headers["www-authenticate"]).toContain("challenge=");
    expect(res.headers["www-authenticate"]).toContain("token-key=");
    expect(res.headers["x-payment-required"]).toBeDefined();
    expect(res.body.error).toBe("Payment required");
    expect(res.body.paymentRequired).toBeDefined();
    expect(res.body.paymentRequired.accepts).toBeDefined();
    expect(res.body.paymentRequired.accepts[0].scheme).toBe("exact");
  });
});

describe("GET /api/weather with valid token", () => {
  it("should return 200 with weather data", async () => {
    const { authHeader } = await createValidToken();
    const res = await request(port!, "/api/weather", { Authorization: authHeader });

    expect(res.status).toBe(200);
    expect(res.body.temperature).toBe(72);
    expect(res.body.condition).toBe("sunny");
    expect(res.body.location).toBe("San Francisco");
  });
});

describe("Token replay prevention", () => {
  it("should return 401 when token is replayed", async () => {
    const { authHeader } = await createValidToken();

    const first = await request(port!, "/api/weather", { Authorization: authHeader });
    expect(first.status).toBe(200);

    const second = await request(port!, "/api/weather", { Authorization: authHeader });
    expect(second.status).toBe(401);
  });
});
