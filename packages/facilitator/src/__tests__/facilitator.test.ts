import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { createServer } from "node:http";
import {
  createVOPRFClient,
  batchBlind,
  generateNonce,
  buildTokenInput,
  createTokenChallenge,
  hashTokenChallenge,
  computeTokenKeyId,
  uint8ArrayToBase64Url,
  TOKEN_COUNT,
} from "@ppg/shared";
import { createApp } from "../index.js";

let baseUrl: string;
let server: Server;

beforeAll(async () => {
  const result = await createApp();
  server = createServer(result.app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (typeof addr === "object" && addr) {
    baseUrl = `http://localhost:${addr.port}`;
  } else {
    throw new Error("Failed to get server address");
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /token-key", () => {
  it("should return 32-byte VOPRF public key as octet-stream", async () => {
    const res = await fetch(`${baseUrl}/token-key`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/octet-stream/);

    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBe(32);
  });
});

describe("POST /issue", () => {
  it("should return 1000 evaluated elements and a proof", async () => {
    const tokenKeyRes = await fetch(`${baseUrl}/token-key`);
    const publicKey = new Uint8Array(await tokenKeyRes.arrayBuffer());

    const client = createVOPRFClient(publicKey);
    const challenge = createTokenChallenge("https://test.example.com");
    const challengeDigest = hashTokenChallenge(challenge);
    const keyId = computeTokenKeyId(publicKey);

    const tokenInputs = Array.from({ length: TOKEN_COUNT }, () => {
      const nonce = generateNonce();
      return buildTokenInput(nonce, challengeDigest, keyId);
    });

    const { evalReq } = await batchBlind(client, tokenInputs);
    expect(evalReq.blinded.length).toBe(TOKEN_COUNT);

    const blindedElements = evalReq.blinded.map((e) =>
      uint8ArrayToBase64Url(e.serialize()),
    );

    const res = await fetch(`${baseUrl}/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentPayload: {},
        blindedElements,
      }),
    });

    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      evaluatedElements: string[];
      proof: string;
      settlement: { success: boolean; transaction: string; network: string };
    };

    expect(data.evaluatedElements).toHaveLength(TOKEN_COUNT);
    expect(data.proof).toBeDefined();
    expect(typeof data.proof).toBe("string");
    expect(data.settlement.success).toBe(true);
    expect(data.settlement.transaction).toBeDefined();
    expect(data.settlement.network).toBeDefined();
  });

  it("should reject requests with wrong number of blinded elements", async () => {
    const res = await fetch(`${baseUrl}/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentPayload: {},
        blindedElements: Array.from({ length: 10 }, () =>
          uint8ArrayToBase64Url(new Uint8Array(32)),
        ),
      }),
    });

    expect(res.status).toBe(422);
  });
});
