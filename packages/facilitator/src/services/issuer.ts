import {
  createVOPRFServer,
  batchIssue,
  deserializeEvaluationRequest,
  base64UrlToUint8Array,
  uint8ArrayToBase64Url,
} from "@ppg/shared";

const ELEMENT_SIZE = 32;

export class Issuer {
  private server: ReturnType<typeof createVOPRFServer>;

  constructor(privateKey: Uint8Array) {
    this.server = createVOPRFServer(privateKey);
  }

  async issue(
    blindedElementsB64: string[],
  ): Promise<{ evaluatedElements: string[]; proof: string }> {
    const blinded = blindedElementsB64.map((b64) => base64UrlToUint8Array(b64));
    const count = blinded.length;

    const buf = new Uint8Array(2 + count * ELEMENT_SIZE);
    new DataView(buf.buffer, buf.byteOffset).setUint16(0, count);
    for (let i = 0; i < count; i++) {
      buf.set(blinded[i], 2 + i * ELEMENT_SIZE);
    }

    const evalReq = deserializeEvaluationRequest(buf);
    const evaluation = await batchIssue(this.server, evalReq);

    const evaluatedElements = evaluation.evaluated.map((e) =>
      uint8ArrayToBase64Url(e.serialize()),
    );
    const proof = uint8ArrayToBase64Url(evaluation.proof!.serialize());

    return { evaluatedElements, proof };
  }
}
