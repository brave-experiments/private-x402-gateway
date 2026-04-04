import type { PaymentRequirements, PaymentPayload } from "@x402/core/types";

export type { PaymentRequirements, PaymentPayload };

export interface IssueRequest {
  paymentPayload: PaymentPayload;
  blindedElements: string[];
}

export interface IssueResponse {
  evaluatedElements: string[];
  proof: string;
  settlement: {
    success: boolean;
    transaction: string;
    network: string;
  };
}

export const TOKEN_TYPE_PRIVATELY_VERIFIABLE = 0x0001;
export const TOKEN_COUNT = 1000;

export interface TokenChallenge {
  tokenType: number;
  issuerName: string;
  redemptionContext: Uint8Array;
  originInfo: string;
}

export interface Token {
  tokenType: number;
  nonce: Uint8Array;
  challengeDigest: Uint8Array;
  keyId: Uint8Array;
  authenticator: Uint8Array;
}

export interface ProtectedRequest {
  token: Token;
  resourceUrl: string;
}

export const ELEMENT_SIZE_RISTRETTO = 32;
export const SCALAR_SIZE_RISTRETTO = 32;
export const PROOF_SIZE_RISTRETTO = SCALAR_SIZE_RISTRETTO * 2;

export interface StandardTokenRequest {
  tokenType: number;
  truncatedTokenKeyId: number;
  blindedMsg: Uint8Array;
}

export interface StandardTokenResponse {
  evaluateMsg: Uint8Array;
  evaluateProof: Uint8Array;
}

export interface IssuerDirectory {
  "issuer-request-uri": string;
  "token-keys": IssuerTokenKey[];
}

export interface IssuerTokenKey {
  "token-type": number;
  "token-key": string;
  "not-before"?: number;
}
