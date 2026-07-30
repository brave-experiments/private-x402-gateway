import { ExactSvmScheme } from "@x402/svm/exact/facilitator";
import { toFacilitatorSvmSigner } from "@x402/svm";
import type { PaymentRequirements, PaymentPayload } from "@x402/core/types";
import { CasperPaymentService } from "./casper-payment.js";

/** Settlement chain selected by PPG_CHAIN. Defaults to Solana. */
function selectedChain(): string {
  return (process.env.PPG_CHAIN || "solana").toLowerCase();
}

function isMockMode(): boolean {
  return selectedChain() !== "casper" && !process.env.PPG_SOLANA_PRIVATE_KEY;
}

export class PaymentService {
  private scheme: ExactSvmScheme | null = null;
  private casper: CasperPaymentService | null = null;

  async init(): Promise<void> {
    if (selectedChain() === "casper") {
      this.casper = new CasperPaymentService();
      console.log(
        `[PaymentService] Running in Casper mode via ${this.casper.baseUrl} ` +
          `(${this.casper.paymentRequirements.network})`,
      );
      return;
    }

    if (isMockMode()) {
      console.log("[PaymentService] Running in mock mode (no PPG_SOLANA_PRIVATE_KEY)");
      return;
    }

    const { createKeyPairSignerFromBytes, createSolanaRpc, devnet } = await import("@solana/kit");

    const privateKeyHex = process.env.PPG_SOLANA_PRIVATE_KEY!;
    const privateKeyBytes = Buffer.from(privateKeyHex, "hex");

    const keypair = await createKeyPairSignerFromBytes(new Uint8Array(privateKeyBytes));
    const rpc = createSolanaRpc(devnet(process.env.PPG_SOLANA_RPC_URL || "https://api.devnet.solana.com"));
    const signer = toFacilitatorSvmSigner(keypair, rpc);
    this.scheme = new ExactSvmScheme(signer);
    console.log("[PaymentService] Running in Solana devnet mode");
  }

  async verifyPayment(
    paymentPayload: unknown,
  ): Promise<{ isValid: boolean; payer?: string }> {
    if (this.casper) {
      const result = await this.casper.verifyPayment(paymentPayload);
      return { isValid: result.isValid, payer: result.payer };
    }

    if (isMockMode() || !this.scheme) {
      void paymentPayload;
      return { isValid: true, payer: "mock-payer" };
    }

    const payload = paymentPayload as PaymentPayload;
    const requirements: PaymentRequirements = {
      scheme: "exact",
      network: (process.env.PPG_SOLANA_NETWORK || "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1") as `${string}:${string}`,
      asset: process.env.PPG_SOLANA_ASSET || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      amount: process.env.PPG_PRICE_AMOUNT || "1000000",
      payTo: process.env.PPG_SOLANA_PAY_TO || "",
      maxTimeoutSeconds: 60,
      extra: {},
    };

    try {
      const result = await this.scheme.verify(payload, requirements);
      return { isValid: result.isValid, payer: result.payer };
    } catch (err) {
      console.error("[PaymentService] Verification error:", err);
      return { isValid: false };
    }
  }

  async settlePayment(
    paymentPayload: unknown,
  ): Promise<{ success: boolean; transaction: string; network: string }> {
    if (this.casper) {
      const result = await this.casper.settlePayment(paymentPayload);
      return {
        success: result.success,
        transaction: result.transaction,
        network: result.network,
      };
    }

    if (isMockMode() || !this.scheme) {
      void paymentPayload;
      return {
        success: true,
        transaction: "mock-tx-" + crypto.randomUUID(),
        network: "mock-network",
      };
    }

    const payload = paymentPayload as PaymentPayload;
    const requirements: PaymentRequirements = {
      scheme: "exact",
      network: (process.env.PPG_SOLANA_NETWORK || "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1") as `${string}:${string}`,
      asset: process.env.PPG_SOLANA_ASSET || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      amount: process.env.PPG_PRICE_AMOUNT || "1000000",
      payTo: process.env.PPG_SOLANA_PAY_TO || "",
      maxTimeoutSeconds: 60,
      extra: {},
    };

    try {
      const result = await this.scheme.settle(payload, requirements);
      return {
        success: result.success,
        transaction: result.transaction,
        network: result.network,
      };
    } catch (err) {
      console.error("[PaymentService] Settlement error:", err);
      return {
        success: false,
        transaction: "error",
        network: requirements.network,
      };
    }
  }
}
