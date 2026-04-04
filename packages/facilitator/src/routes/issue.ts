import { Router } from "express";
import type { Issuer } from "../services/issuer.js";
import type { PaymentService } from "../services/payment.js";
import { TOKEN_COUNT, deserializeStandardTokenRequest, serializeStandardTokenResponse, ELEMENT_SIZE_RISTRETTO, TOKEN_TYPE_PRIVATELY_VERIFIABLE, uint8ArrayToBase64Url, base64UrlToUint8Array } from "@ppg/shared";
import type { IssueRequest } from "@ppg/shared";

export function createIssueRouter(
  issuer: Issuer,
  paymentService: PaymentService,
): Router {
  const router = Router();

  router.post("/request", async (req, res) => {
    if (!Buffer.isBuffer(req.body) && !(req.body instanceof Uint8Array)) {
      res.status(422).json({ error: "Expected binary body" });
      return;
    }

    const data = req.body instanceof Uint8Array ? req.body : new Uint8Array(req.body);
    const tokenReq = deserializeStandardTokenRequest(data);

    if (tokenReq.tokenType !== TOKEN_TYPE_PRIVATELY_VERIFIABLE) {
      res.status(422).json({ error: "Unsupported token type" });
      return;
    }

    if (tokenReq.blindedMsg.length !== ELEMENT_SIZE_RISTRETTO) {
      res.status(422).json({ error: `Invalid blinded message size: expected ${ELEMENT_SIZE_RISTRETTO}` });
      return;
    }

    const { evaluatedElements, proof } = await issuer.issue([uint8ArrayToBase64Url(tokenReq.blindedMsg)]);

    const evaluateMsg = base64UrlToUint8Array(evaluatedElements[0]);
    const evaluateProof = base64UrlToUint8Array(proof);

    const tokenResp = serializeStandardTokenResponse({ evaluateMsg, evaluateProof });
    res.type("application/private-token-response").send(Buffer.from(tokenResp));
  });

  router.post("/issue", async (req, res) => {
    const body = req.body as IssueRequest;

    if (!body.blindedElements || !Array.isArray(body.blindedElements)) {
      res.status(422).json({ error: "blindedElements array required" });
      return;
    }

    if (body.blindedElements.length !== TOKEN_COUNT) {
      res
        .status(422)
        .json({
          error: `Expected ${TOKEN_COUNT} blinded elements, got ${body.blindedElements.length}`,
        });
      return;
    }

    const { isValid } = await paymentService.verifyPayment(body.paymentPayload);
    if (!isValid) {
      res.status(402).json({ error: "Payment verification failed" });
      return;
    }

    const settlement = await paymentService.settlePayment(body.paymentPayload);

    const { evaluatedElements, proof } = await issuer.issue(body.blindedElements);

    res.json({
      evaluatedElements,
      proof,
      settlement,
    });
  });

  return router;
}
