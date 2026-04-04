import type { EvaluationRequest, Evaluation, FinalizeData } from "@cloudflare/voprf-ts";
import {
  createVOPRFClient,
  batchBlind,
  batchFinalize,
  TOKEN_COUNT,
  generateNonce,
  buildTokenInput,
  createToken,
} from "@ppg/shared";
import type { Token } from "@ppg/shared";

export class PPGClient {
  private client: ReturnType<typeof createVOPRFClient>;
  private lastBlindState: {
    nonces: Uint8Array[];
    challengeDigest: Uint8Array;
    keyId: Uint8Array;
  } | null = null;

  constructor(issuerPublicKey: Uint8Array) {
    this.client = createVOPRFClient(issuerPublicKey);
  }

  async blindTokens(
    challengeDigest: Uint8Array,
    keyId: Uint8Array,
  ): Promise<{ finData: FinalizeData; evalReq: EvaluationRequest; nonces: Uint8Array[] }> {
    const nonces: Uint8Array[] = [];
    const tokenInputs: Uint8Array[] = [];

    for (let i = 0; i < TOKEN_COUNT; i++) {
      const nonce = generateNonce();
      nonces.push(nonce);
      tokenInputs.push(buildTokenInput(nonce, challengeDigest, keyId));
    }

    this.lastBlindState = { nonces, challengeDigest, keyId };
    const { finData, evalReq } = await batchBlind(this.client, tokenInputs);
    return { finData, evalReq, nonces };
  }

  async finalizeTokens(finData: FinalizeData, evaluation: Evaluation): Promise<Token[]> {
    if (!this.lastBlindState) {
      throw new Error("Must call blindTokens before finalizeTokens");
    }

    const { nonces, challengeDigest, keyId } = this.lastBlindState;
    const outputs = await batchFinalize(this.client, finData, evaluation);
    const tokens: Token[] = [];

    for (let i = 0; i < outputs.length; i++) {
      tokens.push(createToken(nonces[i], challengeDigest, keyId, outputs[i]));
    }

    return tokens;
  }
}
