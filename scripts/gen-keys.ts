import { createKeyPairSignerFromBytes } from "@solana/kit";
import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/signers";

async function main() {
  const seed1 = crypto.getRandomValues(new Uint8Array(32));
  const seed2 = crypto.getRandomValues(new Uint8Array(32));
  
  const signer1 = await createKeyPairSignerFromPrivateKeyBytes(seed1);
  const signer2 = await createKeyPairSignerFromPrivateKeyBytes(seed2);
  
  // Export public key from both
  const pub1 = await crypto.subtle.exportKey("raw", signer1.keyPair.publicKey as unknown as CryptoKey);
  const pub2 = await crypto.subtle.exportKey("raw", signer2.keyPair.publicKey as unknown as CryptoKey);
  
  // The full 64-byte keypair for createKeyPairSignerFromBytes is: seed(32) || publicKey(32)
  const full1 = Buffer.concat([Buffer.from(seed1), Buffer.from(pub1)]);
  const full2 = Buffer.concat([Buffer.from(seed2), Buffer.from(pub2)]);
  
  // Verify roundtrip
  const verify1 = await createKeyPairSignerFromBytes(new Uint8Array(full1));
  const verify2 = await createKeyPairSignerFromBytes(new Uint8Array(full2));
  
  console.log("CLI (payer) address:", verify1.address);
  console.log("CLI (payer) private key (hex):", full1.toString("hex"));
  console.log("");
  console.log("Facilitator (receiver) address:", verify2.address);
  console.log("Facilitator (receiver) private key (hex):", full2.toString("hex"));
}

main().catch(console.error);
