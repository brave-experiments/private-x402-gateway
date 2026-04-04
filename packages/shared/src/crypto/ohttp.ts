import {
  KeyConfig,
  OHTTPClient as OHTTPClientLib,
  OHTTPServer as OHTTPServerLib,
} from "ohttp-ts";
import type { KeyConfig as KeyConfigType, KeyConfigWithPrivate, SymmetricAlgorithm } from "ohttp-ts";
import { uint8ArrayToBase64, base64ToUint8Array } from "./privacypass.js";

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const hpkePath = require.resolve("hpke", { paths: [require.resolve("ohttp-ts")] });
const { CipherSuite, KEM_DHKEM_X25519_HKDF_SHA256, KDF_HKDF_SHA256, AEAD_AES_128_GCM } = await import(hpkePath);

const SUITE = new CipherSuite(KEM_DHKEM_X25519_HKDF_SHA256, KDF_HKDF_SHA256, AEAD_AES_128_GCM);

export interface StoredOHTTPKeys {
  keyId: number;
  kemId: number;
  publicKey: string;
  privateKey: string;
  kdfId: number;
  aeadId: number;
}

export async function generateOHTTPKeyConfig(keyId: number, symAlgo?: SymmetricAlgorithm): Promise<KeyConfigWithPrivate> {
  const algo: SymmetricAlgorithm = symAlgo ?? { kdfId: 0x0001 as SymmetricAlgorithm["kdfId"], aeadId: 0x0001 as SymmetricAlgorithm["aeadId"] };
  return KeyConfig.generate(SUITE, keyId, [algo]);
}

export async function importOHTTPKeyConfig(stored: StoredOHTTPKeys): Promise<KeyConfigWithPrivate> {
  const keyId = typeof stored.keyId === "number" && stored.keyId >= 0 && stored.keyId <= 255
    ? stored.keyId
    : 1;
  const kdfId = (stored.kdfId ?? 0x0001) as SymmetricAlgorithm["kdfId"];
  const aeadId = (stored.aeadId ?? 0x0001) as SymmetricAlgorithm["aeadId"];
  return KeyConfig.import(
    SUITE,
    keyId,
    base64ToUint8Array(stored.publicKey),
    base64ToUint8Array(stored.privateKey),
    [{ kdfId, aeadId }],
  );
}

export function serializeOHTTPKeyConfigBytes(config: KeyConfigWithPrivate): Uint8Array {
  return KeyConfig.serializeMultiple([config]);
}

export function parseOHTTPKeyConfigBytes(data: Uint8Array): KeyConfigType[] {
  return KeyConfig.parseMultiple(data);
}

export function createOHTTPClient(keyConfig: KeyConfigType): OHTTPClientLib {
  return new OHTTPClientLib(SUITE, keyConfig);
}

export function createOHTTPServer(config: KeyConfigWithPrivate): OHTTPServerLib {
  return new OHTTPServerLib([config]);
}

export async function serializeKeyPairForStorage(config: KeyConfigWithPrivate): Promise<StoredOHTTPKeys> {
  const publicKey = new Uint8Array(await SUITE.SerializePublicKey(config.keyPair.publicKey));
  const privateKey = new Uint8Array(await SUITE.SerializePrivateKey(config.keyPair.privateKey));
  return {
    keyId: config.keyId,
    kemId: config.kemId,
    publicKey: uint8ArrayToBase64(publicKey),
    privateKey: uint8ArrayToBase64(privateKey),
    kdfId: config.symmetricAlgorithms[0].kdfId,
    aeadId: config.symmetricAlgorithms[0].aeadId,
  };
}
