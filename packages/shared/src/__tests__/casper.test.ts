import { describe, it, expect } from "vitest";
import {
  NETWORK_CASPER_MAINNET,
  NETWORK_CASPER_TESTNET,
  CASPER_NETWORKS,
  CASPER_SCHEME_EXACT,
  WCSPR_DECIMALS,
  MOTES_PER_CSPR,
  isCasperNetwork,
  getCasperNetworkConfig,
  isValidCasperAccountHash,
  isValidCasperContractPackageHash,
  csprToMotes,
  motesToCspr,
  buildCasperPaymentRequirements,
} from "../index.js";

const WCSPR_ASSET = "9824d60dc3a5c44a20b9fd260a412437933835b52fc683d8ae36e4ec2114843e";
const PAY_TO = "009e5669b070545e2b32bc66363b9d3d4390fca56bf52a05f1411b7fa18ca311c7";

describe("Casper network configuration", () => {
  it("should support exactly mainnet and testnet", () => {
    expect(CASPER_NETWORKS).toEqual([NETWORK_CASPER_MAINNET, NETWORK_CASPER_TESTNET]);
    expect(NETWORK_CASPER_MAINNET).toBe("casper:casper");
    expect(NETWORK_CASPER_TESTNET).toBe("casper:casper-test");
  });

  it("should map CAIP-2 identifiers to Casper chain names", () => {
    expect(getCasperNetworkConfig(NETWORK_CASPER_MAINNET)).toEqual({
      network: "casper:casper",
      chainName: "casper",
      mainnet: true,
    });
    expect(getCasperNetworkConfig(NETWORK_CASPER_TESTNET)).toEqual({
      network: "casper:casper-test",
      chainName: "casper-test",
      mainnet: false,
    });
  });

  it("should reject non-Casper and unknown networks", () => {
    expect(isCasperNetwork("casper:casper")).toBe(true);
    expect(isCasperNetwork("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1")).toBe(false);
    expect(isCasperNetwork("casper:casper-net-1")).toBe(false);
    expect(() => getCasperNetworkConfig("casper:nonexistent")).toThrow(
      /Unsupported Casper network/,
    );
  });
});

describe("wCSPR mote conversion", () => {
  it("should use 9 decimals", () => {
    expect(WCSPR_DECIMALS).toBe(9);
    expect(MOTES_PER_CSPR).toBe(1_000_000_000n);
  });

  it("should convert whole and fractional CSPR to motes", () => {
    expect(csprToMotes("1")).toBe(1_000_000_000n);
    expect(csprToMotes("0")).toBe(0n);
    expect(csprToMotes("2.5")).toBe(2_500_000_000n);
    expect(csprToMotes("0.000000001")).toBe(1n);
    expect(csprToMotes(" 12.000000009 ")).toBe(12_000_000_009n);
  });

  it("should not confuse 9 decimals with 6 or 18", () => {
    // A 6-decimal reading would yield 1_000_000n, an 18-decimal reading 1e18.
    expect(csprToMotes("1")).not.toBe(1_000_000n);
    expect(csprToMotes("1")).not.toBe(10n ** 18n);
  });

  it("should throw rather than truncate sub-mote precision", () => {
    expect(() => csprToMotes("0.0000000001")).toThrow(
      /exceeds 9 decimals; sub-mote precision would be lost/,
    );
    expect(() => csprToMotes("1.1234567891")).toThrow(/sub-mote precision would be lost/);
  });

  it("should reject malformed amounts", () => {
    for (const bad of ["", "abc", "1.2.3", "-1", "1e9", "1,5"]) {
      expect(() => csprToMotes(bad)).toThrow(/Invalid CSPR amount/);
    }
  });

  it("should format motes back to CSPR without trailing zeros", () => {
    expect(motesToCspr(0n)).toBe("0");
    expect(motesToCspr(1_000_000_000n)).toBe("1");
    expect(motesToCspr(2_500_000_000n)).toBe("2.5");
    expect(motesToCspr(1n)).toBe("0.000000001");
    expect(() => motesToCspr(-1n)).toThrow(/must not be negative/);
  });

  it("should round-trip through motes losslessly", () => {
    for (const amount of ["0", "1", "2.5", "0.000000001", "123456.789"]) {
      expect(motesToCspr(csprToMotes(amount))).toBe(amount);
    }
  });
});

describe("Casper address validation", () => {
  it("should accept account hashes with the 00 tag byte", () => {
    expect(isValidCasperAccountHash(PAY_TO)).toBe(true);
    expect(isValidCasperAccountHash(PAY_TO.toUpperCase())).toBe(true);
  });

  it("should reject malformed account hashes", () => {
    expect(isValidCasperAccountHash(WCSPR_ASSET)).toBe(false); // missing 00 tag
    expect(isValidCasperAccountHash(`01${WCSPR_ASSET}`)).toBe(false);
    expect(isValidCasperAccountHash("00abc")).toBe(false);
  });

  it("should accept bare 64-hex CEP-18 contract package hashes", () => {
    expect(isValidCasperContractPackageHash(WCSPR_ASSET)).toBe(true);
    expect(isValidCasperContractPackageHash(PAY_TO)).toBe(false); // 66 chars
    expect(isValidCasperContractPackageHash("zz")).toBe(false);
  });
});

describe("buildCasperPaymentRequirements", () => {
  const base = {
    network: NETWORK_CASPER_TESTNET,
    asset: WCSPR_ASSET,
    payTo: PAY_TO,
    amount: "1000000000",
  };

  it("should build an x402 v2 exact accepts[] entry", () => {
    const req = buildCasperPaymentRequirements(base);

    expect(req.scheme).toBe(CASPER_SCHEME_EXACT);
    expect(req.network).toBe("casper:casper-test");
    expect(req.asset).toBe(WCSPR_ASSET);
    expect(req.payTo).toBe(PAY_TO);
    expect(req.amount).toBe("1000000000");
    expect(req.maxTimeoutSeconds).toBe(300);
  });

  it("should populate the EIP-712 domain metadata the facilitator requires", () => {
    const req = buildCasperPaymentRequirements(base);

    expect(req.extra).toMatchObject({
      name: "wCSPR",
      version: "1",
      decimals: "9",
      symbol: "wCSPR",
    });
  });

  it("should allow overriding token metadata and timeout", () => {
    const req = buildCasperPaymentRequirements({
      ...base,
      network: NETWORK_CASPER_MAINNET,
      maxTimeoutSeconds: 900,
      tokenName: "Cep18x402",
      tokenVersion: "2",
      tokenSymbol: "CSPR",
    });

    expect(req.network).toBe("casper:casper");
    expect(req.maxTimeoutSeconds).toBe(900);
    expect(req.extra).toMatchObject({ name: "Cep18x402", version: "2", symbol: "CSPR" });
  });

  it("should reject an invalid asset, payTo, amount, network or timeout", () => {
    expect(() => buildCasperPaymentRequirements({ ...base, asset: "deadbeef" })).toThrow(
      /Invalid Casper asset/,
    );
    expect(() => buildCasperPaymentRequirements({ ...base, payTo: WCSPR_ASSET })).toThrow(
      /Invalid Casper payTo/,
    );
    expect(() => buildCasperPaymentRequirements({ ...base, amount: "0" })).toThrow(
      /Invalid Casper amount/,
    );
    expect(() => buildCasperPaymentRequirements({ ...base, amount: "1.5" })).toThrow(
      /Invalid Casper amount/,
    );
    expect(() =>
      buildCasperPaymentRequirements({ ...base, network: "solana:devnet" }),
    ).toThrow(/Unsupported Casper network/);
    expect(() =>
      buildCasperPaymentRequirements({ ...base, maxTimeoutSeconds: 5 }),
    ).toThrow(/maxTimeoutSeconds must be at least 6/);
  });

  it("should accept a mote amount derived from a decimal CSPR price", () => {
    const req = buildCasperPaymentRequirements({
      ...base,
      amount: csprToMotes("0.25").toString(),
    });
    expect(req.amount).toBe("250000000");
  });
});
