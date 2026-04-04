import { join } from "node:path";

const SHARED_KEYS_DIR = process.env.SHARED_KEYS_DIR || join(import.meta.dirname, "../../.keys");

export const CONFIG = {
  port: parseInt(process.env.PORT || "3002"),
  voprfKeyPath: process.env.VOPRF_KEY_PATH || join(SHARED_KEYS_DIR, "voprf.json"),
  ohttpKeyPath: process.env.OHTTP_KEY_PATH || join(SHARED_KEYS_DIR, "ohttp.json"),
};
