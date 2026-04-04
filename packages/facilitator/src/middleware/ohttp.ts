import type { Request, Response, NextFunction } from "express";
import { createOHTTPServer } from "@ppg/shared";
import type { KeyConfigWithPrivate } from "@ppg/shared";

export function createOHTTPMiddleware(
  getKeyConfig: () => KeyConfigWithPrivate,
  innerPort: number,
) {
  let server: ReturnType<typeof createOHTTPServer> | undefined;

  const getServer = () => {
    if (!server) {
      server = createOHTTPServer(getKeyConfig());
    }
    return server;
  };

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.headers["content-type"] !== "message/ohttp-req") {
      next();
      return;
    }

    if (!Buffer.isBuffer(req.body) && !(req.body instanceof Uint8Array)) {
      res.status(400).json({ error: "Expected binary body for message/ohttp-req" });
      return;
    }

    try {
      const body = new Uint8Array(
        Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body),
      );

      const ohttpRequest = new Request(`http://127.0.0.1:${innerPort}/ohttp`, {
        method: "POST",
        headers: { "Content-Type": "message/ohttp-req" },
        body,
      });

      const srv = getServer();
      const { request: innerReq, context } = await srv.decapsulateRequest(ohttpRequest);

      const url = new URL(innerReq.url);
      const innerUrl = `http://127.0.0.1:${innerPort}${url.pathname}${url.search}`;

      const fetchOpts: RequestInit & { duplex?: string } = {
        method: innerReq.method,
        headers: innerReq.headers,
        duplex: "half",
      };
      if (innerReq.body) {
        fetchOpts.body = innerReq.body;
      }

      const innerRes = await fetch(innerUrl, fetchOpts);

      const ohttpResponse = new Response(innerRes.body, {
        status: innerRes.status,
        headers: innerRes.headers,
      });

      const encapsulatedRes = await context.encapsulateResponse(ohttpResponse);
      const resBody = await encapsulatedRes.arrayBuffer();

      res
        .status(200)
        .set("Content-Type", "message/ohttp-res")
        .send(Buffer.from(resBody));
    } catch (err) {
      res.status(400).json({ error: "OHTTP decryption failed", details: String(err) });
    }
  };
}
