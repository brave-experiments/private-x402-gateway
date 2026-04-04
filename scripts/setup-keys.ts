import { mkdir, writeFile } from "node:fs/promises";
import { voprfKeyGen, generateOHTTPKeyConfig, serializeKeyPairForStorage } from "@ppg/shared";

async function main() {
  const keyDir = process.env.KEY_DIR || ".keys";
  await mkdir(keyDir, { recursive: true });

  const voprfKeys = await voprfKeyGen();
  const voprfPath = `${keyDir}/voprf.json`;
  await writeFile(
    voprfPath,
    JSON.stringify({
      privateKey: Buffer.from(voprfKeys.privateKey).toString("base64"),
      publicKey: Buffer.from(voprfKeys.publicKey).toString("base64"),
    }, null, 2),
  );
  console.log(`VOPRF key pair written to ${voprfPath}`);

  const ohttpConfig = await generateOHTTPKeyConfig(2);
  const stored = await serializeKeyPairForStorage(ohttpConfig);
  const ohttpPath = `${keyDir}/ohttp.json`;
  await writeFile(ohttpPath, JSON.stringify(stored, null, 2));
  console.log(`OHTTP key config written to ${ohttpPath}`);

  console.log("\nPublic keys (share with Gateway):");
  console.log(`  VOPRF: ${Buffer.from(voprfKeys.publicKey).toString("base64")}`);
  console.log(`  OHTTP Key ID: ${stored.keyId}`);
}
