import { createHash } from "node:crypto";
import { TOKEN_TYPE_PRIVATELY_VERIFIABLE } from "../types/x402.js";
import type { Token, TokenChallenge, StandardTokenRequest, StandardTokenResponse, IssuerDirectory, IssuerTokenKey } from "../types/x402.js";
import { ELEMENT_SIZE_RISTRETTO, SCALAR_SIZE_RISTRETTO } from "../types/x402.js";

export const NONCE_SIZE = 32;
export const CHALLENGE_DIGEST_SIZE = 32;
export const KEY_ID_SIZE = 32;
export const AUTHENTICATOR_SIZE = 64;

export function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

export function sha512(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha512").update(data).digest());
}

export function generateNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(NONCE_SIZE));
}

export function buildTokenInput(
  nonce: Uint8Array,
  challengeDigest: Uint8Array,
  keyId: Uint8Array,
): Uint8Array {
  const buf = new Uint8Array(2 + NONCE_SIZE + CHALLENGE_DIGEST_SIZE + KEY_ID_SIZE);
  const view = new DataView(buf.buffer);
  view.setUint16(0, TOKEN_TYPE_PRIVATELY_VERIFIABLE);
  buf.set(nonce, 2);
  buf.set(challengeDigest, 2 + NONCE_SIZE);
  buf.set(keyId, 2 + NONCE_SIZE + CHALLENGE_DIGEST_SIZE);
  return buf;
}

export function parseTokenInput(tokenInput: Uint8Array): {
  tokenType: number;
  nonce: Uint8Array;
  challengeDigest: Uint8Array;
  keyId: Uint8Array;
} {
  if (tokenInput.length < 2 + NONCE_SIZE + CHALLENGE_DIGEST_SIZE + KEY_ID_SIZE) {
    throw new Error("Token input too short");
  }
  const view = new DataView(tokenInput.buffer, tokenInput.byteOffset);
  return {
    tokenType: view.getUint16(0),
    nonce: tokenInput.slice(2, 2 + NONCE_SIZE),
    challengeDigest: tokenInput.slice(2 + NONCE_SIZE, 2 + NONCE_SIZE + CHALLENGE_DIGEST_SIZE),
    keyId: tokenInput.slice(2 + NONCE_SIZE + CHALLENGE_DIGEST_SIZE),
  };
}

export function serializeTokenChallenge(challenge: TokenChallenge): Uint8Array {
  const issuerNameBytes = new TextEncoder().encode(challenge.issuerName);
  const originInfoBytes = new TextEncoder().encode(challenge.originInfo);
  const rc = challenge.redemptionContext;

  const buf = new Uint8Array(
    2 + 2 + issuerNameBytes.length + 1 + rc.length + 2 + originInfoBytes.length,
  );
  const view = new DataView(buf.buffer, buf.byteOffset);
  let offset = 0;

  view.setUint16(offset, challenge.tokenType);
  offset += 2;

  view.setUint16(offset, issuerNameBytes.length);
  offset += 2;
  buf.set(issuerNameBytes, offset);
  offset += issuerNameBytes.length;

  buf[offset++] = rc.length;
  if (rc.length > 0) {
    buf.set(rc, offset);
    offset += rc.length;
  }

  view.setUint16(offset, originInfoBytes.length);
  offset += 2;
  buf.set(originInfoBytes, offset);

  return buf;
}

export function deserializeTokenChallenge(data: Uint8Array): TokenChallenge {
  if (data.length < 2) throw new Error("Token challenge too short");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  const tokenType = view.getUint16(offset);
  offset += 2;

  if (offset + 2 > data.length) throw new Error("Token challenge truncated");
  const issuerNameLen = view.getUint16(offset);
  offset += 2;
  if (offset + issuerNameLen > data.length) throw new Error("Token challenge truncated");
  const issuerName = new TextDecoder().decode(data.slice(offset, offset + issuerNameLen));
  offset += issuerNameLen;

  if (offset + 1 > data.length) throw new Error("Token challenge truncated");
  const rcLen = data[offset++];
  if (rcLen !== 0 && rcLen !== 32) throw new Error("Invalid redemption_context length");
  if (offset + rcLen > data.length) throw new Error("Token challenge truncated");
  const redemptionContext = rcLen > 0 ? data.slice(offset, offset + rcLen) : new Uint8Array(0);
  offset += rcLen;

  if (offset + 2 > data.length) throw new Error("Token challenge truncated");
  const originInfoLen = view.getUint16(offset);
  offset += 2;
  if (offset + originInfoLen > data.length) throw new Error("Token challenge truncated");
  const originInfo = new TextDecoder().decode(data.slice(offset, offset + originInfoLen));

  return { tokenType, issuerName, redemptionContext, originInfo };
}

export function createTokenChallenge(
  issuerName: string,
  originInfo: string = "",
  redemptionContext?: Uint8Array,
): TokenChallenge {
  return {
    tokenType: TOKEN_TYPE_PRIVATELY_VERIFIABLE,
    issuerName,
    redemptionContext: redemptionContext ?? new Uint8Array(0),
    originInfo,
  };
}

export function hashTokenChallenge(challenge: TokenChallenge): Uint8Array {
  const serialized = serializeTokenChallenge(challenge);
  return sha256(serialized);
}

export function serializeToken(token: Token): Uint8Array {
  const buf = new Uint8Array(
    2 + NONCE_SIZE + CHALLENGE_DIGEST_SIZE + KEY_ID_SIZE + AUTHENTICATOR_SIZE,
  );
  const view = new DataView(buf.buffer);
  view.setUint16(0, token.tokenType);
  let offset = 2;
  buf.set(token.nonce, offset);
  offset += NONCE_SIZE;
  buf.set(token.challengeDigest, offset);
  offset += CHALLENGE_DIGEST_SIZE;
  buf.set(token.keyId, offset);
  offset += KEY_ID_SIZE;
  buf.set(token.authenticator, offset);
  return buf;
}

export function deserializeToken(data: Uint8Array): Token {
  const expectedSize = 2 + NONCE_SIZE + CHALLENGE_DIGEST_SIZE + KEY_ID_SIZE + AUTHENTICATOR_SIZE;
  if (data.length < expectedSize) {
    throw new Error(`Token too short: expected ${expectedSize} bytes, got ${data.length}`);
  }
  const view = new DataView(data.buffer, data.byteOffset);
  let offset = 0;
  const tokenType = view.getUint16(offset);
  offset += 2;
  const nonce = data.slice(offset, offset + NONCE_SIZE);
  offset += NONCE_SIZE;
  const challengeDigest = data.slice(offset, offset + CHALLENGE_DIGEST_SIZE);
  offset += CHALLENGE_DIGEST_SIZE;
  const keyId = data.slice(offset, offset + KEY_ID_SIZE);
  offset += KEY_ID_SIZE;
  const authenticator = data.slice(offset, offset + AUTHENTICATOR_SIZE);
  return { tokenType, nonce, challengeDigest, keyId, authenticator };
}

export function tokenToNonceHex(token: Token): string {
  return Array.from(token.nonce)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function createToken(
  nonce: Uint8Array,
  challengeDigest: Uint8Array,
  keyId: Uint8Array,
  authenticator: Uint8Array,
): Token {
  return {
    tokenType: TOKEN_TYPE_PRIVATELY_VERIFIABLE,
    nonce,
    challengeDigest,
    keyId,
    authenticator,
  };
}

export function encodeTokenForHeader(token: Token): string {
  return uint8ArrayToBase64Url(serializeToken(token));
}

export function decodeTokenFromHeader(encoded: string): Token {
  return deserializeToken(base64UrlToUint8Array(encoded));
}

export function uint8ArrayToBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

export function serializeStandardTokenRequest(req: StandardTokenRequest): Uint8Array {
  const buf = new Uint8Array(2 + 1 + req.blindedMsg.length);
  const view = new DataView(buf.buffer, buf.byteOffset);
  view.setUint16(0, req.tokenType);
  buf[2] = req.truncatedTokenKeyId;
  buf.set(req.blindedMsg, 3);
  return buf;
}

export function deserializeStandardTokenRequest(data: Uint8Array): StandardTokenRequest {
  if (data.length < 3) throw new Error("TokenRequest too short");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tokenType = view.getUint16(0);
  const truncatedTokenKeyId = data[2];
  const blindedMsg = data.slice(3);
  return { tokenType, truncatedTokenKeyId, blindedMsg };
}

export function serializeStandardTokenResponse(resp: StandardTokenResponse): Uint8Array {
  const buf = new Uint8Array(resp.evaluateMsg.length + resp.evaluateProof.length);
  buf.set(resp.evaluateMsg, 0);
  buf.set(resp.evaluateProof, resp.evaluateMsg.length);
  return buf;
}

export function deserializeStandardTokenResponse(data: Uint8Array): StandardTokenResponse {
  const Ne = ELEMENT_SIZE_RISTRETTO;
  const proofSize = SCALAR_SIZE_RISTRETTO * 2;
  if (data.length < Ne + proofSize) throw new Error("TokenResponse too short");
  return {
    evaluateMsg: data.slice(0, Ne),
    evaluateProof: data.slice(Ne, Ne + proofSize),
  };
}

export function buildIssuerDirectory(
  issuerRequestUri: string,
  tokenType: number,
  tokenKeyBase64: string,
  notBefore?: number,
): IssuerDirectory {
  const tokenKeys: IssuerTokenKey[] = [
    { "token-type": tokenType, "token-key": tokenKeyBase64 },
  ];
  if (notBefore !== undefined) {
    tokenKeys[0]["not-before"] = notBefore;
  }
  return {
    "issuer-request-uri": issuerRequestUri,
    "token-keys": tokenKeys,
  };
}

export function uint8ArrayToBase64Url(data: Uint8Array): string {
  return Buffer.from(data).toString("base64url");
}

export function base64ToUint8Array(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export function base64UrlToUint8Array(b64url: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64url, "base64url"));
}

export function base64UrlPad(b64url: string): string {
  let padded = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4 !== 0) {
    padded += "=";
  }
  return padded;
}
