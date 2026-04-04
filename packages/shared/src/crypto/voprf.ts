import { createHash } from "node:crypto";
import { Oprf, VOPRFClient, VOPRFServer, generateKeyPair } from "@cloudflare/voprf-ts";
import { CryptoNoble } from "@cloudflare/voprf-ts/crypto-noble";
import { Evaluation, EvaluationRequest, FinalizeData } from "@cloudflare/voprf-ts";

const SUITE = Oprf.Suite.RISTRETTO255_SHA512;

export function computeTokenKeyId(publicKey: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(publicKey).digest());
}

export { Oprf, CryptoNoble };

export function getSuite(): string {
  return SUITE;
}

export async function voprfKeyGen(): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
  return generateKeyPair(SUITE, CryptoNoble);
}

export function createVOPRFServer(privateKey: Uint8Array): VOPRFServer {
  return new VOPRFServer(SUITE, privateKey, CryptoNoble);
}

export function createVOPRFClient(publicKey: Uint8Array): VOPRFClient {
  return new VOPRFClient(SUITE, publicKey, CryptoNoble);
}

export async function batchBlind(
  client: VOPRFClient,
  tokenInputs: Uint8Array[],
): Promise<{ finData: FinalizeData; evalReq: EvaluationRequest }> {
  const [finData, evalReq] = await client.blind(tokenInputs);
  return { finData, evalReq };
}

export async function batchIssue(server: VOPRFServer, evalReq: EvaluationRequest): Promise<Evaluation> {
  return server.blindEvaluate(evalReq);
}

export async function batchFinalize(
  client: VOPRFClient,
  finData: FinalizeData,
  evaluation: Evaluation,
): Promise<Uint8Array[]> {
  return client.finalize(finData, evaluation);
}

export async function verifyToken(
  server: VOPRFServer,
  tokenInput: Uint8Array,
  authenticator: Uint8Array,
): Promise<boolean> {
  return server.verifyFinalize(tokenInput, authenticator);
}

export function serializeEvaluationRequest(evalReq: EvaluationRequest): Uint8Array {
  return evalReq.serialize();
}

export function deserializeEvaluationRequest(bytes: Uint8Array): EvaluationRequest {
  return EvaluationRequest.deserialize(SUITE, bytes, CryptoNoble);
}

export function serializeEvaluation(evaluation: Evaluation): Uint8Array {
  return evaluation.serialize();
}

export function deserializeEvaluation(bytes: Uint8Array): Evaluation {
  return Evaluation.deserialize(SUITE, bytes, CryptoNoble);
}

export function serializeFinalizeData(finData: FinalizeData): Uint8Array {
  return finData.serialize();
}

export function deserializeFinalizeData(bytes: Uint8Array): FinalizeData {
  return FinalizeData.deserialize(SUITE, bytes, CryptoNoble);
}

export function blindedElementsToEvalReq(serializedElements: Uint8Array[]): EvaluationRequest {
  const ELEMENT_SIZE = 32;
  const count = serializedElements.length;
  const buf = new Uint8Array(2 + count * ELEMENT_SIZE);
  new DataView(buf.buffer, buf.byteOffset).setUint16(0, count);
  for (let i = 0; i < count; i++) {
    buf.set(new Uint8Array(serializedElements[i]), 2 + i * ELEMENT_SIZE);
  }
  return deserializeEvaluationRequest(buf);
}

export function evaluatedElementsToEvaluation(
  serializedEvaluated: Uint8Array[],
  proofBytes?: Uint8Array,
): Evaluation {
  const ELEMENT_SIZE = 32;
  const count = serializedEvaluated.length;
  const hasProof = !!proofBytes && proofBytes.length > 0;

  const headerSize = 2;
  const proofFlagSize = hasProof ? 1 : 0;
  const proofSize = hasProof ? proofBytes.length : 0;
  const totalLen = headerSize + count * ELEMENT_SIZE + proofFlagSize + proofSize;
  const buf = new Uint8Array(totalLen);

  const view = new DataView(buf.buffer, buf.byteOffset);
  view.setUint16(0, count);

  let offset = headerSize;
  for (let i = 0; i < count; i++) {
    buf.set(new Uint8Array(serializedEvaluated[i]), offset);
    offset += ELEMENT_SIZE;
  }

  if (hasProof) {
    buf[offset++] = 1;
    buf.set(new Uint8Array(proofBytes), offset);
  }

  return deserializeEvaluation(buf);
}
