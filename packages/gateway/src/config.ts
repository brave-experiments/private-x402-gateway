import { join } from "node:path";

const SHARED_KEYS_DIR = process.env.SHARED_KEYS_DIR || join(import.meta.dirname, "../../.keys");

export const CONFIG = {
  port: parseInt(process.env.PORT || "3001"),
  voprfKeyPath: process.env.VOPRF_KEY_PATH || join(SHARED_KEYS_DIR, "voprf.json"),
  ohttpKeyPath: process.env.OHTTP_KEY_PATH || join(SHARED_KEYS_DIR, "ohttp.json"),
  facilitatorUrl: process.env.FACILITATOR_URL || "http://localhost:3002",
  priceAmount: process.env.PRICE_AMOUNT || "1000000",
  priceNetwork: process.env.PRICE_NETWORK || "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  priceAsset: process.env.PRICE_ASSET || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  pricePayTo: process.env.PRICE_PAY_TO || "11111111111111111111111111111111",
};
