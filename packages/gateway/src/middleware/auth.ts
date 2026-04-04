import type { Request, Response, NextFunction } from "express";
import {
  deserializeToken,
  base64UrlToUint8Array,
  uint8ArrayToBase64Url,
  base64UrlPad,
  uint8ArrayToBase64,
  createTokenChallenge,
  hashTokenChallenge,
  serializeTokenChallenge,
  tokenToNonceHex,
} from "@ppg/shared";
import type { Token, PaymentRequirements } from "@ppg/shared";
import { TokenVerifier } from "../services/verifier.js";
import { ReplayStore } from "../services/replay-store.js";
import { CONFIG } from "../config.js";

export interface PaymentRequired {
  x402Version: number;
  error?: string;
  resource: { url: string; description?: string; mimeType?: string };
  accepts: PaymentRequirements[];
  extensions?: Record<string, unknown>;
}

interface AuthenticatedRequest extends Request {
  token?: Token;
}

function buildPaymentRequired(origin: string): PaymentRequired {
  return {
    x402Version: 2,
    resource: { url: origin },
    accepts: [
      {
        scheme: "exact",
        network: CONFIG.priceNetwork as `${string}:${string}`,
        asset: CONFIG.priceAsset,
        amount: CONFIG.priceAmount,
        payTo: CONFIG.pricePayTo,
        maxTimeoutSeconds: 60,
        extra: {},
      },
    ],
  };
}

export function createAuthMiddleware(
  verifier: TokenVerifier,
  replayStore: ReplayStore,
  issuerPublicKey: Uint8Array,
) {
  const challenge = createTokenChallenge("gateway", "gateway");
  const challengeDigest = hashTokenChallenge(challenge);
  const serializedChallenge = serializeTokenChallenge(challenge);

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("PrivateToken ")) {
      const paymentRequired = buildPaymentRequired(req.protocol + "://" + req.get("host") + req.originalUrl);

      const challengeB64 = base64UrlPad(uint8ArrayToBase64Url(serializedChallenge));
      const pubkeyB64 = base64UrlPad(uint8ArrayToBase64Url(issuerPublicKey));
      const paymentB64 = uint8ArrayToBase64(Buffer.from(JSON.stringify(paymentRequired)));

      res
        .status(402)
        .set({
          "WWW-Authenticate": `PrivateToken challenge="${challengeB64}", token-key="${pubkeyB64}"`,
          "X-Payment-Required": paymentB64,
        })
        .json({ error: "Payment required", paymentRequired });
      return;
    }

    try {
      const match = authHeader.match(/^PrivateToken\s+token="([^"]+)"/);
      if (!match) {
        res.status(401).json({ error: "Invalid authorization header" });
        return;
      }

      const tokenBytes = base64UrlToUint8Array(match[1]);
      const token = deserializeToken(tokenBytes);

      const tokenInput = verifier.buildTokenInput(token.nonce, token.challengeDigest, token.keyId);

      if (replayStore.isUsed(token.nonce)) {
        res.status(401).json({ error: "Token already used" });
        return;
      }

      const valid = await verifier.verify(tokenInput, token.authenticator);
      if (!valid) {
        res.status(401).json({ error: "Invalid token" });
        return;
      }

      replayStore.markUsed(token.nonce);
      req.token = token;
      next();
    } catch {
      res.status(401).json({ error: "Token verification failed" });
    }
  };
}
