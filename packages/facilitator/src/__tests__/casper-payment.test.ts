import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NETWORK_CASPER_MAINNET, NETWORK_CASPER_TESTNET } from "@ppg/shared";
import {
  CasperPaymentService,
  DEFAULT_CASPER_FACILITATOR_URL,
} from "../services/casper-payment.js";

const WCSPR_ASSET = "9824d60dc3a5c44a20b9fd260a412437933835b52fc683d8ae36e4ec2114843e";
const PAY_TO = "009e5669b070545e2b32bc66363b9d3d4390fca56bf52a05f1411b7fa18ca311c7";
const PAYER = "00048a54220799a48171743407c086668bdcc788e2a31e4185fe52d0682634f888";
const DEPLOY_HASH = "88461218a5e972fcda1d764d7cc4edb2e0c3a538123b97890d484f43c55935f5";

const PAYMENT_PAYLOAD = {
  x402Version: 2,
  resource: { url: "http://localhost:3002/issue" },
  accepted: {
    scheme: "exact",
    network: NETWORK_CASPER_TESTNET,
    asset: WCSPR_ASSET,
    amount: "1000000000",
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
  },
  payload: {
    signature: `01${"ab".repeat(64)}`,
    publicKey: "0176197d7191ce519ed043221956a2227921abf30364d4362970229027ec828f04",
    authorization: {
      from: PAYER,
      to: PAY_TO,
      value: "1000000000",
      validAfter: "1710000000",
      validBefore: "1710000900",
      nonce: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    },
  },
};

function createService(overrides = {}) {
  return new CasperPaymentService({
    network: NETWORK_CASPER_TESTNET,
    asset: WCSPR_ASSET,
    payTo: PAY_TO,
    amount: "1000000000",
    accessToken: "test-token",
    ...overrides,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.PPG_CASPER_FACILITATOR_URL;
});

describe("CasperPaymentService configuration", () => {
  it("should default to the CSPR.cloud facilitator", () => {
    expect(createService().baseUrl).toBe(DEFAULT_CASPER_FACILITATOR_URL);
    expect(DEFAULT_CASPER_FACILITATOR_URL).toBe("https://x402-facilitator.cspr.cloud");
  });

  it("should allow overriding the facilitator URL via option", () => {
    const service = createService({ facilitatorUrl: "http://localhost:9999/" });
    expect(service.baseUrl).toBe("http://localhost:9999");
  });

  it("should allow overriding the facilitator URL via PPG_CASPER_FACILITATOR_URL", async () => {
    process.env.PPG_CASPER_FACILITATOR_URL = "https://staging.example.com";
    const service = new CasperPaymentService({
      network: NETWORK_CASPER_MAINNET,
      asset: WCSPR_ASSET,
      payTo: PAY_TO,
      amount: "1000000000",
    });

    expect(service.baseUrl).toBe("https://staging.example.com");

    fetchMock.mockResolvedValue(jsonResponse({ isValid: true, payer: PAYER }));
    await service.verifyPayment(PAYMENT_PAYLOAD);
    expect(fetchMock.mock.calls[0][0]).toBe("https://staging.example.com/verify");
  });

  it("should expose the accepts[] entry it verifies against", () => {
    const req = createService().paymentRequirements;
    expect(req.scheme).toBe("exact");
    expect(req.network).toBe(NETWORK_CASPER_TESTNET);
    expect(req.amount).toBe("1000000000");
    expect(req.extra).toMatchObject({ decimals: "9" });
  });

  it("should reject an unsupported network at construction time", () => {
    expect(() => createService({ network: "casper:casper-net-1" })).toThrow(
      /Unsupported Casper network/,
    );
  });
});

describe("CasperPaymentService.verifyPayment", () => {
  it("should return the payer on a valid payload", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ isValid: true, payer: PAYER }));

    const result = await createService().verifyPayment(PAYMENT_PAYLOAD);

    expect(result).toEqual({ isValid: true, payer: PAYER });
  });

  it("should post paymentPayload and paymentRequirements with the access token", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ isValid: true, payer: PAYER }));

    await createService().verifyPayment(PAYMENT_PAYLOAD);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${DEFAULT_CASPER_FACILITATOR_URL}/verify`);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe("test-token");

    const body = JSON.parse(init.body as string);
    expect(body.paymentPayload).toEqual(PAYMENT_PAYLOAD);
    expect(body.paymentRequirements.network).toBe(NETWORK_CASPER_TESTNET);
    expect(body.paymentRequirements.asset).toBe(WCSPR_ASSET);
  });

  it("should surface the facilitator's invalidReason", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        isValid: false,
        invalidReason: "invalid_signature",
        invalidMessage: "signature verification failed",
      }),
    );

    const result = await createService().verifyPayment(PAYMENT_PAYLOAD);

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("invalid_signature");
    expect(result.payer).toBeUndefined();
  });

  it("should fail closed on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));

    const result = await createService().verifyPayment(PAYMENT_PAYLOAD);

    expect(result).toEqual({ isValid: false, invalidReason: "facilitator_unreachable" });
  });

  it("should fail closed when the facilitator is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await createService().verifyPayment(PAYMENT_PAYLOAD);

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("facilitator_unreachable");
  });

  it("should fail closed on an unparseable body", async () => {
    fetchMock.mockResolvedValue(new Response("not json", { status: 200 }));

    const result = await createService().verifyPayment(PAYMENT_PAYLOAD);

    expect(result.isValid).toBe(false);
  });
});

describe("CasperPaymentService.settlePayment", () => {
  it("should return the deploy hash on success", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        transaction: DEPLOY_HASH,
        network: NETWORK_CASPER_TESTNET,
        payer: PAYER,
      }),
    );

    const result = await createService().settlePayment(PAYMENT_PAYLOAD);

    expect(result).toEqual({
      success: true,
      transaction: DEPLOY_HASH,
      network: NETWORK_CASPER_TESTNET,
      payer: PAYER,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_CASPER_FACILITATOR_URL}/settle`);
  });

  it("should surface the facilitator's errorReason on a failed settlement", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: false,
        errorReason: "put_deploy_failed",
        errorMessage: "failed to submit the transaction",
        transaction: "",
        network: NETWORK_CASPER_TESTNET,
        payer: "",
      }),
    );

    const result = await createService().settlePayment(PAYMENT_PAYLOAD);

    expect(result.success).toBe(false);
    expect(result.errorReason).toBe("put_deploy_failed");
    expect(result.transaction).toBe("");
    expect(result.network).toBe(NETWORK_CASPER_TESTNET);
  });

  it("should fail closed when the facilitator is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("socket hang up"));

    const result = await createService().settlePayment(PAYMENT_PAYLOAD);

    expect(result).toEqual({
      success: false,
      transaction: "",
      network: NETWORK_CASPER_TESTNET,
      errorReason: "facilitator_unreachable",
    });
  });
});

describe("CasperPaymentService.supported", () => {
  it("should return the facilitator's supported kinds", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        kinds: [
          { x402Version: 2, scheme: "exact", network: NETWORK_CASPER_MAINNET },
          { x402Version: 2, scheme: "exact", network: NETWORK_CASPER_TESTNET },
        ],
      }),
    );

    const { kinds } = await createService().supported();

    expect(kinds.map((k) => k.network)).toEqual([
      NETWORK_CASPER_MAINNET,
      NETWORK_CASPER_TESTNET,
    ]);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  });

  it("should return no kinds when the facilitator is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));

    expect(await createService().supported()).toEqual({ kinds: [] });
  });
});
