import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { voprfKeyGen, uint8ArrayToBase64, base64ToUint8Array, generateOHTTPKeyConfig, importOHTTPKeyConfig, serializeKeyPairForStorage, serializeOHTTPKeyConfigBytes } from "@ppg/shared";
import type { KeyConfigWithPrivate, StoredOHTTPKeys } from "@ppg/shared";
import { CONFIG } from "../config.js";

interface StoredVOPRFKeys {
  privateKey: string;
  publicKey: string;
}

const OHTTP_KEY_ID = 1;

export class KeyManager {
  voprfPrivateKey: Uint8Array;
  voprfPublicKey: Uint8Array;
  ohttpKeyConfig: KeyConfigWithPrivate;

  private constructor(
    voprfPrivateKey: Uint8Array,
    voprfPublicKey: Uint8Array,
    ohttpKeyConfig: KeyConfigWithPrivate,
  ) {
    this.voprfPrivateKey = voprfPrivateKey;
    this.voprfPublicKey = voprfPublicKey;
    this.ohttpKeyConfig = ohttpKeyConfig;
  }

  static async load(): Promise<KeyManager> {
    try {
      const voprfRaw = await readFile(CONFIG.voprfKeyPath, "utf-8");
      const voprfStored: StoredVOPRFKeys = JSON.parse(voprfRaw);

      let ohttpKeyConfig: KeyConfigWithPrivate;
      try {
        const ohttpRaw = await readFile(CONFIG.ohttpKeyPath, "utf-8");
        const stored: StoredOHTTPKeys = JSON.parse(ohttpRaw);
        ohttpKeyConfig = await importOHTTPKeyConfig(stored);
        await KeyManager.saveOHTTPKeys(ohttpKeyConfig);
      } catch {
        ohttpKeyConfig = await generateOHTTPKeyConfig(OHTTP_KEY_ID);
        await KeyManager.saveOHTTPKeys(ohttpKeyConfig);
      }

      return new KeyManager(
        base64ToUint8Array(voprfStored.privateKey),
        base64ToUint8Array(voprfStored.publicKey),
        ohttpKeyConfig,
      );
    } catch {
      const keys = await voprfKeyGen();
      const ohttpKeyConfig = await generateOHTTPKeyConfig(OHTTP_KEY_ID);

      await mkdir(dirname(CONFIG.voprfKeyPath), { recursive: true });
      await writeFile(
        CONFIG.voprfKeyPath,
        JSON.stringify({
          privateKey: uint8ArrayToBase64(keys.privateKey),
          publicKey: uint8ArrayToBase64(keys.publicKey),
        } satisfies StoredVOPRFKeys, null, 2),
      );

      await KeyManager.saveOHTTPKeys(ohttpKeyConfig);

      return new KeyManager(keys.privateKey, keys.publicKey, ohttpKeyConfig);
    }
  }

  private static async saveOHTTPKeys(config: KeyConfigWithPrivate): Promise<void> {
    const stored = await serializeKeyPairForStorage(config);
    await mkdir(dirname(CONFIG.ohttpKeyPath), { recursive: true });
    await writeFile(CONFIG.ohttpKeyPath, JSON.stringify(stored, null, 2));
  }

  getSerializedOHTTPKeys(): Uint8Array {
    return serializeOHTTPKeyConfigBytes(this.ohttpKeyConfig);
  }
}
