import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  voprfKeyGen,
  createToken,
  generateNonce,
  hashTokenChallenge,
  createTokenChallenge,
  serializeToken,
  deserializeToken,
  uint8ArrayToBase64Url,
  base64UrlToUint8Array,
  createVOPRFServer,
  batchIssue,
  computeTokenKeyId,
} from "@ppg/shared";
import type { Token } from "@ppg/shared";
import { PPGClient } from "../services/client.js";
import { PaymentClient } from "../services/payment.js";
import { getTokens } from "../services/token-store.js";
import { clearTokens, storeTokens, ensureDir, TOKEN_STORE_PATH } from "../services/token-store.js";
import { Command } from "commander";

function generateAuthenticator(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(64));
}

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "ppg-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("token-store", () => {
  it("stores and retrieves tokens", async () => {
    await withTempDir(async (dir) => {
      const tokens: Token[] = [
        createToken(generateNonce(), generateNonce(), generateNonce(), generateAuthenticator()),
        createToken(generateNonce(), generateNonce(), generateNonce(), generateAuthenticator()),
      ];

      const storePath = join(dir, "tokens.json");
      const encoded = tokens.map((t) => uint8ArrayToBase64Url(serializeToken(t)));
      await writeFile(storePath, JSON.stringify(encoded, null, 2), "utf-8");

      const data = await readFile(storePath, "utf-8");
      const restored = (JSON.parse(data) as string[]).map((s) =>
        deserializeToken(base64UrlToUint8Array(s)),
      );

      expect(restored).toHaveLength(2);
      for (let i = 0; i < tokens.length; i++) {
        const orig = tokens[i];
        const r = restored[i];
        expect(r.tokenType).toBe(orig.tokenType);
        expect(Buffer.from(r.nonce).toString("hex")).toBe(Buffer.from(orig.nonce).toString("hex"));
        expect(Buffer.from(r.challengeDigest).toString("hex")).toBe(
          Buffer.from(orig.challengeDigest).toString("hex"),
        );
        expect(Buffer.from(r.keyId).toString("hex")).toBe(Buffer.from(orig.keyId).toString("hex"));
        expect(Buffer.from(r.authenticator).toString("hex")).toBe(
          Buffer.from(orig.authenticator).toString("hex"),
        );
      }
    });
  });

  it("returns empty array when store does not exist", async () => {
    const tokens = await getTokens();
    expect(tokens).toHaveLength(0);
  });

  it("clearTokens removes all stored tokens", async () => {
    const tokens: Token[] = [
      createToken(generateNonce(), generateNonce(), generateNonce(), generateAuthenticator()),
    ];
    await storeTokens(tokens);
    expect(await getTokens()).toHaveLength(1);

    await clearTokens();
    expect(await getTokens()).toHaveLength(0);
  });
});

describe("PPGClient", () => {
  it("blind and finalize tokens round-trip", async () => {
    const { publicKey, privateKey } = await voprfKeyGen();
    const client = new PPGClient(publicKey);

    const challenge = createTokenChallenge("https://example.com");
    const challengeDigest = hashTokenChallenge(challenge);

    const { finData, evalReq, nonces } = await client.blindTokens(challengeDigest, computeTokenKeyId(publicKey));

    expect(nonces).toHaveLength(1000);
    expect(evalReq).toBeDefined();
    expect(finData).toBeDefined();

    const server = createVOPRFServer(privateKey);
    const evaluation = await batchIssue(server, evalReq);

    const tokens = await client.finalizeTokens(finData, evaluation);
    expect(tokens).toHaveLength(1000);

    for (const token of tokens) {
      expect(token.tokenType).toBe(0x0001);
      expect(token.nonce).toBeInstanceOf(Uint8Array);
      expect(token.challengeDigest).toBeInstanceOf(Uint8Array);
      expect(token.keyId).toBeInstanceOf(Uint8Array);
      expect(token.authenticator).toBeInstanceOf(Uint8Array);
    }
  }, 30_000);
});

describe("PaymentClient", () => {
  it("creates mock payment", async () => {
    const pc = new PaymentClient(null);
    const payment = await pc.createPayment({
      scheme: "mock",
      network: "solana:mainnet",
      asset: "SOL",
      amount: "100",
      payTo: "test",
      maxTimeoutSeconds: 60,
      extra: {},
    });
    expect((payment as any).mock).toBe(true);
    expect((payment as any).amount).toBe("100");
    expect((payment as any).network).toBe("solana:mainnet");
  });
});

describe("CLI help text", () => {
  it("generates help for program", () => {
    const program = new Command();
    program.name("ppg").description("CLI for consuming APIs privately through the Private Payments Gateway").version("0.1.0");

    const help = program.helpInformation();
    expect(help).toContain("ppg");
    expect(help).toContain("CLI for consuming APIs privately");
  });
});
