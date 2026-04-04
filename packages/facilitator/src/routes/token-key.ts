import { Router } from "express";
import type { KeyManager } from "../services/key-manager.js";
import { serializeOHTTPKeyConfigBytes, uint8ArrayToBase64Url, base64UrlPad, buildIssuerDirectory, TOKEN_TYPE_PRIVATELY_VERIFIABLE } from "@ppg/shared";

export function createTokenKeyRouter(keyManager: KeyManager): Router {
  const router = Router();

  router.get("/token-key", (_req, res) => {
    const { publicKey } = keyManager.getKeyPair();
    res.type("application/octet-stream").send(Buffer.from(publicKey));
  });

  router.get("/ohttp-keys", (_req, res) => {
    const config = keyManager.getOHTTPKeyConfig();
    const serialized = serializeOHTTPKeyConfigBytes(config);
    res.type("application/ohttp-keys").send(Buffer.from(serialized));
  });

  router.get("/.well-known/private-token-issuer-directory", (_req, res) => {
    const { publicKey } = keyManager.getKeyPair();
    const tokenKeyB64 = base64UrlPad(uint8ArrayToBase64Url(publicKey));
    const directory = buildIssuerDirectory(
      "/request",
      TOKEN_TYPE_PRIVATELY_VERIFIABLE,
      tokenKeyB64,
    );
    res.type("application/private-token-issuer-directory").json(directory);
  });

  return router;
}
