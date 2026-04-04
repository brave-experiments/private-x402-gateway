import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { genPaymentKeyAction, loadPaymentKey } from "../commands/gen-payment-key.js";

describe("gen-payment-key", () => {
  let testDir: string;
  let keyFile: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "ppg-key-test-"));
    keyFile = join(testDir, "payment-key.json");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("generates a keypair and returns a public key", async () => {
    const { publicKey, keyPath } = await genPaymentKeyAction(keyFile);

    expect(publicKey).toBeDefined();
    expect(typeof publicKey).toBe("string");
    expect(publicKey.length).toBeGreaterThan(0);
    expect(keyPath).toBe(keyFile);
  });

  it("saves the key to the expected file", async () => {
    await genPaymentKeyAction(keyFile);

    const data = await readFile(keyFile, "utf-8");
    const key = JSON.parse(data);

    expect(key.privateKeyHex).toBeDefined();
    expect(typeof key.privateKeyHex).toBe("string");
    expect(key.privateKeyHex.length).toBe(128); // 64 bytes (seed + pubkey) hex
    expect(key.publicKey).toBeDefined();
    expect(typeof key.publicKey).toBe("string");
  });

  it("can reload the saved key", async () => {
    const { publicKey: genPubKey } = await genPaymentKeyAction(keyFile);
    const loaded = await loadPaymentKey(keyFile);

    expect(loaded.publicKey).toBe(genPubKey);
    expect(loaded.privateKeyHex).toBeDefined();
  });

  it("refuses to overwrite an existing key", async () => {
    const { publicKey: pub1 } = await genPaymentKeyAction(keyFile);

    await expect(genPaymentKeyAction(keyFile)).rejects.toThrow("already exists");

    const loaded = await loadPaymentKey(keyFile);
    expect(loaded.publicKey).toBe(pub1);
  });

  it("migrates old 32-byte seed to 64-byte keypair", async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const oldHex = Buffer.from(seed).toString("hex");
    await writeFile(keyFile, JSON.stringify({
      privateKeyHex: oldHex,
      publicKey: "will-be-overwritten",
    }), "utf-8");

    const loaded = await loadPaymentKey(keyFile);

    expect(loaded.privateKeyHex.length).toBe(128);
    expect(loaded.privateKeyHex.startsWith(oldHex)).toBe(true);

    const data = await readFile(keyFile, "utf-8");
    const persisted = JSON.parse(data);
    expect(persisted.privateKeyHex.length).toBe(128);
  });
});
