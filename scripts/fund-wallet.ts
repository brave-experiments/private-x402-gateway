async function runFundWallet() {
  console.log("=== PPG Fund Wallet ===\n");

  if (!process.env.PPG_SOLANA_PRIVATE_KEY) {
    console.log("Error: PPG_SOLANA_PRIVATE_KEY environment variable is required.");
    console.log("Set it to a Solana keypair private key in hex format.");
    process.exit(1);
  }

  const { createKeyPairSignerFromBytes, createSolanaRpc, devnet } = await import("@solana/kit");

  const privateKeyHex = process.env.PPG_SOLANA_PRIVATE_KEY;
  const privateKeyBytes = Buffer.from(privateKeyHex!, "hex");

  console.log("[+] Creating keypair from private key...");
  const keypair = await createKeyPairSignerFromBytes(new Uint8Array(privateKeyBytes));
  console.log(`[+] Address: ${keypair.address}`);

  const rpcUrl = process.env.PPG_SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const rpc = createSolanaRpc(devnet(rpcUrl));
  console.log(`[+] Connected to Solana devnet at ${rpcUrl}`);

  try {
    const balance = await rpc.getBalance(keypair.address).send();
    const balanceSol = Number(balance.value) / 1e9;
    console.log(`[+] Current SOL balance: ${balanceSol} SOL`);
  } catch (err) {
    console.log("[*] Could not fetch balance (account may not exist yet)");
  }

  console.log("[*] To fund this wallet on Solana devnet:");
  console.log(`    1. Visit https://faucet.solana.com`);
  console.log(`    2. Enter address: ${keypair.address}`);
  console.log(`    3. Request 2 SOL airdrop`);
  console.log("");
  console.log("[*] Or use the Solana CLI:");
  console.log(`    solana airdrop 2 ${keypair.address} --url ${rpcUrl}`);
  console.log("");
  console.log("[+] Wallet configuration:");
  console.log(`    Address: ${keypair.address}`);
  console.log(`    RPC URL: ${rpcUrl}`);
}

runFundWallet().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
