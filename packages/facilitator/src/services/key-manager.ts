import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  voprfKeyGen,
  uint8ArrayToBase64,
  base64ToUint8Array,
  generateOHTTPKeyConfig,
  importOHTTPKeyConfig,
  serializeKeyPairForStorage,
} from "@ppg/shared";
import type { KeyConfigWithPrivate, StoredOHTTPKeys } from "@ppg/shared";
import { CONFIG } from "../config.js";

interface KeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

interface SerializedVOPRFKeys {
  privateKey: string;
  publicKey: string;
}

const OHTTP_KEY_ID = 2;

export class KeyManager {
  private voprfKeyPair: KeyPair | null = null;
  private ohttpKeyConfig: KeyConfigWithPrivate | null = null;

  async init(): Promise<void> {
    await this.loadOrGenerateVOPRFKeys();
    await this.loadOrGenerateOHTTPKeys();
  }

  private async loadOrGenerateVOPRFKeys(): Promise<void> {
    try {
      const data = await readFile(CONFIG.voprfKeyPath, "utf-8");
      const serialized: SerializedVOPRFKeys = JSON.parse(data);
      this.voprfKeyPair = {
        privateKey: new Uint8Array(Buffer.from(serialized.privateKey, "base64")),
        publicKey: new Uint8Array(Buffer.from(serialized.publicKey, "base64")),
      };
    } catch {
      const keyPair = await voprfKeyGen();
      this.voprfKeyPair = keyPair;
      await mkdir(dirname(CONFIG.voprfKeyPath), { recursive: true });
      const serialized: SerializedVOPRFKeys = {
        privateKey: Buffer.from(keyPair.privateKey).toString("base64"),
        publicKey: Buffer.from(keyPair.publicKey).toString("base64"),
      };
      await writeFile(CONFIG.voprfKeyPath, JSON.stringify(serialized, null, 2));
    }
  }

  private async loadOrGenerateOHTTPKeys(): Promise<void> {
    try {
      const data = await readFile(CONFIG.ohttpKeyPath, "utf-8");
      const stored: StoredOHTTPKeys = JSON.parse(data);
      this.ohttpKeyConfig = await importOHTTPKeyConfig(stored);
      await this.saveOHTTPKeys();
    } catch {
      this.ohttpKeyConfig = await generateOHTTPKeyConfig(OHTTP_KEY_ID);
      await this.saveOHTTPKeys();
    }
  }

  private async saveOHTTPKeys(): Promise<void> {
    if (!this.ohttpKeyConfig) return;
    const stored = await serializeKeyPairForStorage(this.ohttpKeyConfig);
    await mkdir(dirname(CONFIG.ohttpKeyPath), { recursive: true });
    await writeFile(CONFIG.ohttpKeyPath, JSON.stringify(stored, null, 2));
  }

  getKeyPair(): KeyPair {
    if (!this.voprfKeyPair) throw new Error("KeyManager not initialized");
    return this.voprfKeyPair;
  }

  getOHTTPKeyConfig(): KeyConfigWithPrivate {
    if (!this.ohttpKeyConfig) throw new Error("KeyManager not initialized");
    return this.ohttpKeyConfig;
  }
}
