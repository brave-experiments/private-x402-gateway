import express, { json, raw } from "express";
import { KeyManager } from "./services/key-manager.js";
import { TokenVerifier } from "./services/verifier.js";
import { ReplayStore } from "./services/replay-store.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createOHTTPMiddleware } from "./middleware/ohttp.js";
import { apiRouter } from "./routes/api.js";
import { CONFIG } from "./config.js";

let app: ReturnType<typeof express>;
let innerApp: ReturnType<typeof express>;
let keyManager: KeyManager;
let verifier: TokenVerifier;
let replayStore: ReplayStore;
let innerPort: number;

export async function createApp() {
  keyManager = await KeyManager.load();
  verifier = new TokenVerifier(keyManager.voprfPrivateKey);
  replayStore = new ReplayStore();

  const serializedKeys = keyManager.getSerializedOHTTPKeys();

  innerApp = express();
  innerApp.use(json());

  const auth = createAuthMiddleware(verifier, replayStore, keyManager.voprfPublicKey);
  innerApp.get("/ohttp-keys", (_req, res) => {
    res.type("application/ohttp-keys").send(Buffer.from(serializedKeys));
  });
  innerApp.use("/api", auth, apiRouter);

  const innerServer = await new Promise<import("node:http").Server>((resolve) => {
    const s = innerApp.listen(0, "127.0.0.1", () => resolve(s));
  });
  innerPort = (innerServer.address() as { port: number }).port;

  app = express();
  app.use(json());
  app.use(raw({ type: "message/ohttp-req", limit: "1mb" }));
  app.use(createOHTTPMiddleware(() => keyManager.ohttpKeyConfig, innerPort));

  app.get("/ohttp-keys", (_req, res) => {
    res.type("application/ohttp-keys").send(Buffer.from(serializedKeys));
  });
  app.use("/api", auth, apiRouter);

  return { app, innerApp, keyManager, verifier, replayStore, innerServer };
}

export { app, keyManager, verifier, replayStore };

const PORT = CONFIG.port;
createApp().then(({ app, innerServer }) => {
  app.listen(PORT, () => {
    console.log(`Gateway listening on port ${PORT} (inner on ${(innerServer.address() as { port: number }).port})`);
  });
});
