import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  serializeToken,
  deserializeToken,
  uint8ArrayToBase64Url,
  base64UrlToUint8Array,
} from "@ppg/shared";
import type { Token } from "@ppg/shared";

const TOKEN_STORE_DIR = join(homedir(), ".ppg");
export const TOKEN_STORE_PATH = join(TOKEN_STORE_DIR, "tokens.json");

export async function ensureDir(): Promise<void> {
  await mkdir(TOKEN_STORE_DIR, { recursive: true });
}

export async function getTokens(): Promise<Token[]> {
  try {
    const data = await readFile(TOKEN_STORE_PATH, "utf-8");
    const encoded: string[] = JSON.parse(data);
    return encoded.map((s) => deserializeToken(base64UrlToUint8Array(s)));
  } catch {
    return [];
  }
}

export async function storeTokens(tokens: Token[]): Promise<void> {
  await ensureDir();
  const encoded = tokens.map((t) => uint8ArrayToBase64Url(serializeToken(t)));
  await writeFile(TOKEN_STORE_PATH, JSON.stringify(encoded, null, 2), "utf-8");
}

export async function consumeToken(): Promise<Token | null> {
  const tokens = await getTokens();
  if (tokens.length === 0) return null;
  const [first, ...rest] = tokens;
  await storeTokens(rest);
  return first;
}

export async function getCount(): Promise<number> {
  const tokens = await getTokens();
  return tokens.length;
}

export async function clearTokens(): Promise<void> {
  await rm(TOKEN_STORE_PATH, { force: true });
}
