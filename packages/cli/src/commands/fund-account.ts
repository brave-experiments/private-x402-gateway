import { loadPaymentKey } from "./gen-payment-key.js";
import { createKeyPairSignerFromBytes, createSolanaRpc, devnet, type Address } from "@solana/kit";

const DEFAULT_RPC_URLS = [
  "https://api.devnet.solana.com",
  "https://devnet.sonic.game",
];
const DEFAULT_AIRDROP_AMOUNT = 2;

export interface FaucetResult {
  success: boolean;
  method: string;
  signature?: string;
  amount: number;
  error?: string;
}

export async function airdropViaFaucet(publicKey: string, amount: number): Promise<FaucetResult> {
  try {
    const res = await fetch("https://faucet.solana.com/api/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress: publicKey,
        amount,
        network: "devnet",
        cloudflareCallback: null,
      }),
    });
    if (res.ok) {
      return { success: true, method: "faucet.solana.com", amount };
    }
    const text = await res.text();
    return { success: false, method: "faucet.solana.com", amount, error: text.trim() || `HTTP ${res.status}` };
  } catch (err) {
    return {
      success: false,
      method: "faucet.solana.com",
      amount,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function airdropViaRpc(
  publicKey: string,
  amount: number,
  rpcUrl: string,
): Promise<FaucetResult> {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "requestAirdrop",
        params: [publicKey, amount * 1e9],
      }),
    });
    const json: any = await res.json();
    if (json.error) {
      return { success: false, method: `RPC (${rpcUrl})`, amount, error: json.error.message };
    }
    if (!json.result) {
      return { success: false, method: `RPC (${rpcUrl})`, amount, error: "No signature returned" };
    }
    return { success: true, method: `RPC (${rpcUrl})`, amount, signature: json.result };
  } catch (err) {
    return {
      success: false,
      method: `RPC (${rpcUrl})`,
      amount,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getBalance(publicKey: string, rpcUrl: string): Promise<number> {
  const rpc = createSolanaRpc(devnet(rpcUrl));
  try {
    const balance = await rpc.getBalance(publicKey as Address).send();
    return Number(balance.value) / 1e9;
  } catch {
    return 0;
  }
}

export async function fundAccountAction(options: {
  amount?: number;
  rpcUrl?: string;
}): Promise<FaucetResult> {
  const key = await loadPaymentKey();
  const amount = options.amount ?? DEFAULT_AIRDROP_AMOUNT;
  const rpcUrls = options.rpcUrl ? [options.rpcUrl] : DEFAULT_RPC_URLS;

  const currentBalance = await getBalance(key.publicKey, rpcUrls[0]);
  console.warn(`Current balance: ${currentBalance} SOL`);

  if (currentBalance >= amount) {
    console.warn(`Balance of ${currentBalance} SOL is sufficient. No airdrop needed.`);
    return { success: true, method: "already funded", amount: 0 };
  }

  console.warn(`Funding ${key.publicKey} with ${amount} SOL on devnet...`);

  let result = await airdropViaFaucet(key.publicKey, amount);

  if (!result.success) {
    console.warn(`faucet.solana.com: ${result.error}`);
    for (const rpcUrl of rpcUrls) {
      console.warn(`Trying ${rpcUrl}...`);
      result = await airdropViaRpc(key.publicKey, amount, rpcUrl);
      if (result.success) break;
      console.warn(`${result.method}: ${result.error}`);
    }
  }

  if (result.success) {
    const rpcUrl = rpcUrls[0];
    const rpc = createSolanaRpc(devnet(rpcUrl));
    const { address } = await createKeyPairSignerFromBytes(
      new Uint8Array(Buffer.from(key.privateKeyHex, "hex")),
    );
    const balance = await rpc.getBalance(address).send();
    const balanceSol = Number(balance.value) / 1e9;
    console.warn(`Funded via ${result.method}. Balance: ${balanceSol} SOL`);
    if (result.signature) {
      console.warn(`Transaction: ${result.signature}`);
    }
  }

  return result;
}
