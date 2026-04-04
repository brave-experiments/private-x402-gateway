import express, { json, raw } from "express";
import { CONFIG } from "./config.js";
import { KeyManager } from "./services/key-manager.js";
import { Issuer } from "./services/issuer.js";
import { PaymentService } from "./services/payment.js";
import { createTokenKeyRouter } from "./routes/token-key.js";
import { createIssueRouter } from "./routes/issue.js";
import { createOHTTPMiddleware } from "./middleware/ohttp.js";

export async function createApp() {
  const keyManager = new KeyManager();
  await keyManager.init();

  const issuer = new Issuer(keyManager.getKeyPair().privateKey);
  const paymentService = new PaymentService();
  await paymentService.init();

  const innerApp = express();
  innerApp.use(json());
  innerApp.use(raw({ type: "application/private-token-request", limit: "1kb" }));
  innerApp.use(createTokenKeyRouter(keyManager));
  innerApp.use(createIssueRouter(issuer, paymentService));

  const innerServer = await new Promise<import("node:http").Server>((resolve) => {
    const s = innerApp.listen(0, "127.0.0.1", () => resolve(s));
  });
  const innerPort = (innerServer.address() as { port: number }).port;

  const app = express();
  app.use(json());
  app.use(raw({ type: "message/ohttp-req", limit: "1mb" }));
  app.use(raw({ type: "application/private-token-request", limit: "1kb" }));
  app.use(createOHTTPMiddleware(() => keyManager.getOHTTPKeyConfig(), innerPort));
  app.use(createTokenKeyRouter(keyManager));
  app.use(createIssueRouter(issuer, paymentService));

  return { app, innerApp, innerServer, innerPort };
}

createApp()
  .then(({ app, innerPort }) => {
    app.listen(CONFIG.port, () => {
      console.log(`Facilitator listening on port ${CONFIG.port} (inner on ${innerPort})`);
    });
  })
  .catch((err) => {
    console.error("Failed to start facilitator:", err);
    process.exit(1);
  });
