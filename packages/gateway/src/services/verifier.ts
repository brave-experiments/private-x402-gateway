import { createVOPRFServer, verifyToken, buildTokenInput } from "@ppg/shared";

export class TokenVerifier {
  private server: ReturnType<typeof createVOPRFServer>;

  constructor(privateKey: Uint8Array) {
    this.server = createVOPRFServer(privateKey);
  }

  async verify(tokenInput: Uint8Array, authenticator: Uint8Array): Promise<boolean> {
    return verifyToken(this.server, tokenInput, authenticator);
  }

  buildTokenInput(nonce: Uint8Array, challengeDigest: Uint8Array, keyId: Uint8Array): Uint8Array {
    return buildTokenInput(nonce, challengeDigest, keyId);
  }
}
