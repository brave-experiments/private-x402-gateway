import {
  buildCasperPaymentRequirements,
  getCasperNetworkConfig,
  NETWORK_CASPER_TESTNET,
} from "@ppg/shared";
import type { PaymentRequirements } from "@ppg/shared";

/** Default CSPR.cloud x402 facilitator, which serves mainnet and testnet. */
export const DEFAULT_CASPER_FACILITATOR_URL = "https://x402-facilitator.cspr.cloud";

/** Requests to the facilitator are aborted after this many milliseconds. */
const FACILITATOR_TIMEOUT_MS = 30_000;

export interface CasperSettlementOptions {
  /** Base URL of the x402 facilitator. Overridable for staging or self-hosting. */
  facilitatorUrl?: string;
  /** CSPR.cloud access token, sent in the Authorization header. */
  accessToken?: string;
  /** CAIP-2 network to settle on. */
  network?: string;
  /** CEP-18 contract package hash of the settlement asset (wCSPR). */
  asset?: string;
  /** Casper account hash receiving the payment. */
  payTo?: string;
  /** Price in motes as a decimal string. */
  amount?: string;
  /** Authorization validity window handed to the payer. */
  maxTimeoutSeconds?: number;
}

interface CasperVerifyResponse {
  isValid: boolean;
  payer?: string;
  invalidReason?: string;
  invalidMessage?: string;
}

interface CasperSettleResponse {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
  errorReason?: string;
  errorMessage?: string;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/**
 * Settles x402 `exact` payments on the Casper Network via the CSPR.cloud
 * facilitator HTTP API (`/verify`, `/settle`, `/supported`).
 *
 * This mirrors the Solana `PaymentService` seam: the facilitator process
 * verifies before it settles, and every failure path is fail-closed — a
 * transport error, a non-2xx response or an unparseable body all resolve to
 * "payment rejected" rather than throwing past the caller.
 */
export class CasperPaymentService {
  private readonly facilitatorUrl: string;
  private readonly accessToken?: string;
  private readonly requirements: PaymentRequirements;

  constructor(options: CasperSettlementOptions = {}) {
    this.facilitatorUrl = trimTrailingSlash(
      options.facilitatorUrl ||
        process.env.PPG_CASPER_FACILITATOR_URL ||
        DEFAULT_CASPER_FACILITATOR_URL,
    );
    this.accessToken = options.accessToken || process.env.PPG_CASPER_ACCESS_TOKEN;

    const network =
      options.network || process.env.PPG_CASPER_NETWORK || NETWORK_CASPER_TESTNET;

    // Fail fast on a misconfigured network rather than at settlement time.
    getCasperNetworkConfig(network);

    this.requirements = buildCasperPaymentRequirements({
      network,
      asset: options.asset || process.env.PPG_CASPER_ASSET || "",
      payTo: options.payTo || process.env.PPG_CASPER_PAY_TO || "",
      amount: options.amount || process.env.PPG_PRICE_AMOUNT || "1000000",
      maxTimeoutSeconds: options.maxTimeoutSeconds,
    });
  }

  /** The `accepts[]` entry advertised to clients in a 402 response. */
  get paymentRequirements(): PaymentRequirements {
    return this.requirements;
  }

  /** Base URL this service talks to, after env/option resolution. */
  get baseUrl(): string {
    return this.facilitatorUrl;
  }

  async verifyPayment(
    paymentPayload: unknown,
  ): Promise<{ isValid: boolean; payer?: string; invalidReason?: string }> {
    const body = await this.post<CasperVerifyResponse>("/verify", paymentPayload);
    if (!body) {
      return { isValid: false, invalidReason: "facilitator_unreachable" };
    }

    if (!body.isValid) {
      return {
        isValid: false,
        invalidReason: body.invalidReason || "verification_failed",
      };
    }

    return { isValid: true, payer: body.payer };
  }

  async settlePayment(
    paymentPayload: unknown,
  ): Promise<{
    success: boolean;
    transaction: string;
    network: string;
    payer?: string;
    errorReason?: string;
  }> {
    const network = this.requirements.network;
    const body = await this.post<CasperSettleResponse>("/settle", paymentPayload);
    if (!body) {
      return {
        success: false,
        transaction: "",
        network,
        errorReason: "facilitator_unreachable",
      };
    }

    if (!body.success) {
      return {
        success: false,
        transaction: body.transaction || "",
        network: body.network || network,
        errorReason: body.errorReason || "settlement_failed",
      };
    }

    return {
      success: true,
      transaction: body.transaction || "",
      network: body.network || network,
      payer: body.payer,
    };
  }

  /** Payment kinds the configured facilitator can verify and settle. */
  async supported(): Promise<{
    kinds: Array<{ x402Version: number; scheme: string; network: string }>;
  }> {
    const res = await this.request("/supported", { method: "GET" });
    if (!res || !res.ok) {
      return { kinds: [] };
    }
    try {
      return (await res.json()) as {
        kinds: Array<{ x402Version: number; scheme: string; network: string }>;
      };
    } catch {
      return { kinds: [] };
    }
  }

  private async post<T>(path: string, paymentPayload: unknown): Promise<T | null> {
    const res = await this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentPayload,
        paymentRequirements: this.requirements,
      }),
    });

    if (!res || !res.ok) {
      if (res) {
        console.error(`[CasperPaymentService] ${path} returned HTTP ${res.status}`);
      }
      return null;
    }

    try {
      return (await res.json()) as T;
    } catch (err) {
      console.error(`[CasperPaymentService] ${path} returned an unparseable body:`, err);
      return null;
    }
  }

  private async request(path: string, init: RequestInit): Promise<Response | null> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (this.accessToken) {
      headers.set("Authorization", this.accessToken);
    }

    try {
      return await fetch(`${this.facilitatorUrl}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(FACILITATOR_TIMEOUT_MS),
      });
    } catch (err) {
      console.error(`[CasperPaymentService] ${path} request failed:`, err);
      return null;
    }
  }
}
