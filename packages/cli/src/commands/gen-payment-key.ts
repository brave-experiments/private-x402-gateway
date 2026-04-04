import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/signers";
import { writeFile, mkdir, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export const PPG_DIR = join(homedir(), ".ppg");
export const DEFAULT_KEY_FILE = join(PPG_DIR, "payment-key.json");

interface StoredKey {
  privateKeyHex: string;
  publicKey: string;
}

export async function genPaymentKeyAction(keyFile?: string): Promise<{ publicKey: string; keyPath: string }> {
  const filePath = keyFile ?? DEFAULT_KEY_FILE;
  const dir = join(filePath, "..");

  try {
    await access(filePath);
    throw new Error(`Payment key already exists at ${filePath}. Delete it first if you want to generate a new one.`);
  } catch (err) {
    if (err instanceof TypeError || (err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);

  const pubKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey("raw", signer.keyPair.publicKey as unknown as CryptoKey),
  );
  const privateKeyHex = Buffer.concat([Buffer.from(seed), Buffer.from(pubKeyBytes)]).toString("hex");
  const publicKey = signer.address;

  await mkdir(dir, { recursive: true });
  await writeFile(filePath, JSON.stringify({ privateKeyHex, publicKey } as StoredKey, null, 2), "utf-8");

  return { publicKey, keyPath: filePath };
}

export async function loadPaymentKey(keyFile?: string): Promise<StoredKey> {
  const filePath = keyFile ?? DEFAULT_KEY_FILE;
  const data = await readFile(filePath, "utf-8");
  const key = JSON.parse(data) as StoredKey;

  if (key.privateKeyHex.length === 64) {
    const seed = Buffer.from(key.privateKeyHex, "hex");
    const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
    const pubKeyBytes = new Uint8Array(
      await crypto.subtle.exportKey("raw", signer.keyPair.publicKey as unknown as CryptoKey),
    );
    const fullKeyHex = Buffer.concat([seed, Buffer.from(pubKeyBytes)]).toString("hex");
    key.privateKeyHex = fullKeyHex;
    await writeFile(filePath, JSON.stringify(key, null, 2), "utf-8");
  }

  return key;
}
