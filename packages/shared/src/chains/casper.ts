import type { PaymentRequirements } from "../types/x402.js";

/** CAIP-2 identifier for Casper Mainnet. */
export const NETWORK_CASPER_MAINNET = "casper:casper";

/** CAIP-2 identifier for Casper Testnet. */
export const NETWORK_CASPER_TESTNET = "casper:casper-test";

export type CasperNetwork =
  | typeof NETWORK_CASPER_MAINNET
  | typeof NETWORK_CASPER_TESTNET;

export const CASPER_NETWORKS: readonly CasperNetwork[] = [
  NETWORK_CASPER_MAINNET,
  NETWORK_CASPER_TESTNET,
];

/** The only x402 scheme the Casper facilitator settles. */
export const CASPER_SCHEME_EXACT = "exact";

/**
 * wCSPR is a CEP-18 token with 9 decimals. Its base unit is a mote:
 * 1 CSPR = 1_000_000_000 motes.
 */
export const WCSPR_DECIMALS = 9;

/** Motes in one whole CSPR. */
export const MOTES_PER_CSPR = 10n ** BigInt(WCSPR_DECIMALS);

/** The Casper facilitator requires at least 6s of authorization validity. */
export const CASPER_MIN_TIMEOUT_SECONDS = 6;

export interface CasperNetworkConfig {
  /** CAIP-2 network identifier. */
  network: CasperNetwork;
  /** Casper chain name used inside transaction payloads. */
  chainName: string;
  /** Whether this is a production network. */
  mainnet: boolean;
}

const CASPER_NETWORK_CONFIGS: Record<CasperNetwork, CasperNetworkConfig> = {
  [NETWORK_CASPER_MAINNET]: {
    network: NETWORK_CASPER_MAINNET,
    chainName: "casper",
    mainnet: true,
  },
  [NETWORK_CASPER_TESTNET]: {
    network: NETWORK_CASPER_TESTNET,
    chainName: "casper-test",
    mainnet: false,
  },
};

/** Casper account hashes are 32 bytes hex-encoded behind an "00" tag byte. */
const ACCOUNT_HASH_PATTERN = /^00[0-9a-f]{64}$/i;

/** CEP-18 contract package hashes are bare 32-byte hex strings. */
const CONTRACT_PACKAGE_HASH_PATTERN = /^[0-9a-f]{64}$/i;

const DECIMAL_AMOUNT_PATTERN = /^(\d+)(?:\.(\d+))?$/;

/**
 * Narrow an arbitrary string to a supported Casper CAIP-2 network.
 */
export function isCasperNetwork(network: string): network is CasperNetwork {
  return (CASPER_NETWORKS as readonly string[]).includes(network);
}

/**
 * Look up the static configuration for a supported Casper network.
 *
 * @throws if the network is not a Casper network this gateway settles on.
 */
export function getCasperNetworkConfig(network: string): CasperNetworkConfig {
  if (!isCasperNetwork(network)) {
    throw new Error(
      `Unsupported Casper network: ${network} (expected one of ${CASPER_NETWORKS.join(", ")})`,
    );
  }
  return CASPER_NETWORK_CONFIGS[network];
}

/**
 * Validate a Casper account hash such as a `payTo` recipient.
 */
export function isValidCasperAccountHash(value: string): boolean {
  return ACCOUNT_HASH_PATTERN.test(value);
}

/**
 * Validate a CEP-18 contract package hash such as the wCSPR asset identifier.
 */
export function isValidCasperContractPackageHash(value: string): boolean {
  return CONTRACT_PACKAGE_HASH_PATTERN.test(value);
}

/**
 * Convert a decimal CSPR amount to motes.
 *
 * Sub-mote precision is rejected rather than truncated: silently dropping
 * fractions of a mote would let a client under-pay by an amount the
 * facilitator would still accept as "exact".
 *
 * @param amount - Decimal CSPR amount, e.g. "1.25".
 * @returns The equivalent amount in motes.
 * @throws if the amount is malformed or carries more than 9 decimal places.
 */
export function csprToMotes(amount: string): bigint {
  const match = DECIMAL_AMOUNT_PATTERN.exec(amount.trim());
  if (!match) {
    throw new Error(`Invalid CSPR amount: ${amount}`);
  }

  const [, whole, fraction = ""] = match;
  if (fraction.length > WCSPR_DECIMALS) {
    throw new Error(
      `CSPR amount ${amount} exceeds ${WCSPR_DECIMALS} decimals; sub-mote precision would be lost`,
    );
  }

  const padded = fraction.padEnd(WCSPR_DECIMALS, "0");
  return BigInt(whole) * MOTES_PER_CSPR + BigInt(padded || "0");
}

/**
 * Render a mote amount as a decimal CSPR string, without trailing zeros.
 */
export function motesToCspr(motes: bigint): string {
  if (motes < 0n) {
    throw new Error(`Mote amount must not be negative: ${motes}`);
  }

  const whole = motes / MOTES_PER_CSPR;
  const remainder = motes % MOTES_PER_CSPR;
  if (remainder === 0n) {
    return whole.toString();
  }

  const fraction = remainder
    .toString()
    .padStart(WCSPR_DECIMALS, "0")
    .replace(/0+$/, "");
  return `${whole}.${fraction}`;
}

export interface CasperPaymentRequirementsInput {
  /** CAIP-2 network to settle on. */
  network: string;
  /** CEP-18 contract package hash of the settlement asset (wCSPR). */
  asset: string;
  /** Casper account hash receiving the payment. */
  payTo: string;
  /** Price in motes as a decimal string. */
  amount: string;
  /** Authorization validity window handed to the payer. */
  maxTimeoutSeconds?: number;
  /** CEP-18 token metadata used to build the EIP-712 domain. */
  tokenName?: string;
  tokenVersion?: string;
  tokenSymbol?: string;
}

/**
 * Build an x402 v2 `exact` scheme entry for the `accepts[]` array of a 402
 * response. The Casper facilitator derives the EIP-712 signing domain from
 * `extra.name` and `extra.version`, so both are always populated.
 */
export function buildCasperPaymentRequirements(
  input: CasperPaymentRequirementsInput,
): PaymentRequirements {
  const { network } = getCasperNetworkConfig(input.network);

  if (!isValidCasperContractPackageHash(input.asset)) {
    throw new Error(
      `Invalid Casper asset: ${input.asset} (expected a 64-character CEP-18 contract package hash)`,
    );
  }

  if (!isValidCasperAccountHash(input.payTo)) {
    throw new Error(
      `Invalid Casper payTo: ${input.payTo} (expected an account hash of the form 00<64 hex chars>)`,
    );
  }

  if (!/^\d+$/.test(input.amount) || BigInt(input.amount) <= 0n) {
    throw new Error(
      `Invalid Casper amount: ${input.amount} (expected a positive integer mote amount)`,
    );
  }

  const maxTimeoutSeconds = input.maxTimeoutSeconds ?? 300;
  if (maxTimeoutSeconds < CASPER_MIN_TIMEOUT_SECONDS) {
    throw new Error(
      `maxTimeoutSeconds must be at least ${CASPER_MIN_TIMEOUT_SECONDS}, got ${maxTimeoutSeconds}`,
    );
  }

  return {
    scheme: CASPER_SCHEME_EXACT,
    network: network as `${string}:${string}`,
    asset: input.asset,
    amount: input.amount,
    payTo: input.payTo,
    maxTimeoutSeconds,
    extra: {
      name: input.tokenName ?? "wCSPR",
      version: input.tokenVersion ?? "1",
      decimals: String(WCSPR_DECIMALS),
      symbol: input.tokenSymbol ?? "wCSPR",
    },
  } as PaymentRequirements;
}
