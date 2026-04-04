import type { PaymentRequirements, PaymentPayload } from "@ppg/shared";
import { ExactSvmSchemeV1 } from "@x402/svm/exact/v1/client";
import { toClientSvmSigner } from "@x402/svm";
import type { ClientSvmSigner } from "@x402/svm";
import { loadPaymentKey } from "../commands/gen-payment-key.js";

async function getPrivateKeyHex(): Promise<string | null> {
  try {
    const key = await loadPaymentKey();
    return key.privateKeyHex;
  } catch {
    return null;
  }
}

export async function getPaymentMode(): Promise<{ mock: boolean; network: string }> {
  const key = await getPrivateKeyHex();
  if (!key) {
    return { mock: true, network: "mock" };
  }
  return { mock: false, network: process.env.PPG_SOLANA_RPC_URL || "devnet" };
}

export class PaymentClient {
  private _keyOverride: string | null | undefined;

  constructor(keyOverride?: string | null) {
    this._keyOverride = keyOverride;
  }

  async createPayment(requirements: PaymentRequirements): Promise<PaymentPayload> {
    const privateKeyHex = this._keyOverride === undefined
      ? await getPrivateKeyHex()
      : this._keyOverride;
    if (!privateKeyHex) {
      return {
        mock: true,
        amount: requirements.amount,
        network: requirements.network,
      } as unknown as PaymentPayload;
    }

    const { createKeyPairSignerFromBytes } = await import("@solana/kit");

    const privateKeyBytes = Buffer.from(privateKeyHex, "hex");
    const keypair = await createKeyPairSignerFromBytes(new Uint8Array(privateKeyBytes));
    const signer = toClientSvmSigner(keypair) as ClientSvmSigner;

    const scheme = new ExactSvmSchemeV1(signer);
    const result = await scheme.createPaymentPayload(2, requirements);

    return {
      x402Version: result.x402Version,
      payload: result.payload,
      scheme: result.scheme,
      network: result.network,
    } as unknown as PaymentPayload;
  }
}
