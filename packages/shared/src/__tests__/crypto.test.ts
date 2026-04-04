import { describe, it, expect } from "vitest";
import {
  voprfKeyGen,
  createVOPRFServer,
  createVOPRFClient,
  batchBlind,
  batchIssue,
  batchFinalize,
  verifyToken,
  generateNonce,
  buildTokenInput,
  parseTokenInput,
  sha256,
  serializeTokenChallenge,
  deserializeTokenChallenge,
  createTokenChallenge,
  hashTokenChallenge,
  serializeToken,
  deserializeToken,
  tokenToNonceHex,
  serializeStandardTokenRequest,
  deserializeStandardTokenRequest,
  serializeStandardTokenResponse,
  deserializeStandardTokenResponse,
  buildIssuerDirectory,
  TOKEN_COUNT,
} from "../index.js";

describe("VOPRF full cycle", () => {
  it("should complete blind-evaluate-finalize cycle with Ristretto255-SHA512", async () => {
    const { privateKey, publicKey } = await voprfKeyGen();
    const server = createVOPRFServer(privateKey);
    const client = createVOPRFClient(publicKey);

    const tokenInputs: Uint8Array[] = [];
    for (let i = 0; i < 10; i++) {
      tokenInputs.push(crypto.getRandomValues(new Uint8Array(32)));
    }

    const { finData, evalReq } = await batchBlind(client, tokenInputs);
    expect(evalReq.blinded.length).toBe(10);

    const evaluation = await batchIssue(server, evalReq);
    expect(evaluation.evaluated.length).toBe(10);
    expect(evaluation.proof).toBeDefined();

    const outputs = await batchFinalize(client, finData, evaluation);
    expect(outputs.length).toBe(10);

    for (let i = 0; i < 10; i++) {
      const valid = await verifyToken(server, tokenInputs[i], outputs[i]);
      expect(valid).toBe(true);
    }
  });

  it("should support 1000 token batch", async () => {
    const { privateKey, publicKey } = await voprfKeyGen();
    const server = createVOPRFServer(privateKey);
    const client = createVOPRFClient(publicKey);

    const tokenInputs = Array.from({ length: TOKEN_COUNT }, () =>
      crypto.getRandomValues(new Uint8Array(32)),
    );

    const { finData, evalReq } = await batchBlind(client, tokenInputs);
    expect(evalReq.blinded.length).toBe(TOKEN_COUNT);

    const evaluation = await batchIssue(server, evalReq);
    expect(evaluation.evaluated.length).toBe(TOKEN_COUNT);
  });
});

describe("Privacy Pass token framing", () => {
  it("should round-trip token serialization", () => {
    const nonce = generateNonce();
    const challengeDigest = sha256(new Uint8Array([1, 2, 3]));
    const keyId = crypto.getRandomValues(new Uint8Array(32));
    const authenticator = crypto.getRandomValues(new Uint8Array(64));

    const token = { tokenType: 1, nonce, challengeDigest, keyId, authenticator };
    const serialized = serializeToken(token);
    expect(serialized.length).toBe(162);

    const deserialized = deserializeToken(serialized);
    expect(deserialized.nonce).toEqual(token.nonce);
    expect(deserialized.challengeDigest).toEqual(token.challengeDigest);
    expect(deserialized.keyId).toEqual(token.keyId);
    expect(deserialized.authenticator).toEqual(token.authenticator);
    expect(deserialized.tokenType).toBe(1);
  });

  it("should produce deterministic nonce hex", () => {
    const nonce = new Uint8Array([0, 1, 2, 255]);
    expect(tokenToNonceHex({ tokenType: 1, nonce, challengeDigest: new Uint8Array(32), keyId: new Uint8Array(32), authenticator: new Uint8Array(64) })).toBe(
      "000102ff",
    );
  });

  it("should build and parse token inputs correctly", () => {
    const nonce = generateNonce();
    const challengeDigest = sha256(new Uint8Array([1, 2, 3]));
    const keyId = crypto.getRandomValues(new Uint8Array(32));

    const tokenInput = buildTokenInput(nonce, challengeDigest, keyId);
    expect(tokenInput.length).toBe(2 + 32 + 32 + 32);

    const parsed = parseTokenInput(tokenInput);
    expect(parsed.tokenType).toBe(1);
    expect(parsed.nonce).toEqual(nonce);
    expect(parsed.challengeDigest).toEqual(challengeDigest);
    expect(parsed.keyId).toEqual(keyId);
  });

  it("should round-trip token challenge serialization per RFC 9577", () => {
    const challenge = {
      tokenType: 1,
      issuerName: "issuer.example.com",
      redemptionContext: crypto.getRandomValues(new Uint8Array(32)),
      originInfo: "gateway.example.com",
    };
    const serialized = serializeTokenChallenge(challenge);
    const deserialized = deserializeTokenChallenge(serialized);
    expect(deserialized.tokenType).toBe(1);
    expect(deserialized.issuerName).toBe("issuer.example.com");
    expect(deserialized.redemptionContext).toEqual(challenge.redemptionContext);
    expect(deserialized.originInfo).toBe("gateway.example.com");
  });

  it("should serialize token challenge with empty redemption context", () => {
    const challenge = {
      tokenType: 1,
      issuerName: "issuer.example.com",
      redemptionContext: new Uint8Array(0),
      originInfo: "",
    };
    const serialized = serializeTokenChallenge(challenge);
    const deserialized = deserializeTokenChallenge(serialized);
    expect(deserialized.redemptionContext.length).toBe(0);
    expect(deserialized.originInfo).toBe("");
  });

  it("should hash token challenges deterministically", () => {
    const challenge = createTokenChallenge("issuer.example.com");
    const hash1 = hashTokenChallenge(challenge);
    const hash2 = hashTokenChallenge(challenge);
    expect(hash1).toEqual(hash2);
    expect(hash1.length).toBe(32);
  });
});

describe("Standard issuance protocol (RFC 9578)", () => {
  it("should round-trip standard TokenRequest serialization", () => {
    const req = {
      tokenType: 0x0001,
      truncatedTokenKeyId: 0xAB,
      blindedMsg: crypto.getRandomValues(new Uint8Array(32)),
    };
    const serialized = serializeStandardTokenRequest(req);
    const deserialized = deserializeStandardTokenRequest(serialized);
    expect(deserialized.tokenType).toBe(0x0001);
    expect(deserialized.truncatedTokenKeyId).toBe(0xAB);
    expect(deserialized.blindedMsg).toEqual(req.blindedMsg);
  });

  it("should round-trip standard TokenResponse serialization", () => {
    const resp = {
      evaluateMsg: crypto.getRandomValues(new Uint8Array(32)),
      evaluateProof: crypto.getRandomValues(new Uint8Array(64)),
    };
    const serialized = serializeStandardTokenResponse(resp);
    const deserialized = deserializeStandardTokenResponse(serialized);
    expect(deserialized.evaluateMsg).toEqual(resp.evaluateMsg);
    expect(deserialized.evaluateProof).toEqual(resp.evaluateProof);
  });

  it("should build issuer directory with correct fields", () => {
    const dir = buildIssuerDirectory("https://issuer.example.com/request", 1, "abc123==");
    expect(dir["issuer-request-uri"]).toBe("https://issuer.example.com/request");
    expect(dir["token-keys"]).toHaveLength(1);
    expect(dir["token-keys"][0]["token-type"]).toBe(1);
    expect(dir["token-keys"][0]["token-key"]).toBe("abc123==");
  });

  it("should build issuer directory with not-before", () => {
    const dir = buildIssuerDirectory("/request", 1, "abc", 1686913811);
    expect(dir["token-keys"][0]["not-before"]).toBe(1686913811);
  });
});
