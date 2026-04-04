#!/usr/bin/env node
import { Command } from "commander";
import { requestAction } from "./commands/request.js";
import { buyTokensAction } from "./commands/buy-tokens.js";
import { balanceAction } from "./commands/balance.js";
import { clearTokensAction } from "./commands/clear-tokens.js";
import { genPaymentKeyAction } from "./commands/gen-payment-key.js";
import { fundAccountAction } from "./commands/fund-account.js";

const program = new Command();

program
  .name("private-pay")
  .description("CLI for consuming APIs privately through the Private Payments Gateway")
  .version("0.1.0")
  .option("--facilitator <url>", "Facilitator URL", "http://localhost:3002")
  .option("--relay <url>", "OHTTP relay URL", "http://localhost:3000");

program
  .command("request")
  .description("Make a private request to a URL")
  .argument("<url>", "The URL to request")
  .option("--auto-purchase", "Automatically purchase tokens when payment is required")
  .action(async (url: string, opts: { autoPurchase?: boolean }) => {
    const globalOpts = program.opts();
    try {
      const result = await requestAction(url, {
        facilitator: globalOpts.facilitator,
        relay: globalOpts.relay,
        autoPurchase: opts.autoPurchase,
      });
      console.log(result);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("buy-tokens")
  .description("Purchase privacy pass tokens")
  .option("--gateway <url>", "Gateway URL", "http://localhost:3001")
  .action(async (opts: { gateway?: string }) => {
    const globalOpts = program.opts();
    try {
      const count = await buyTokensAction({
        facilitator: globalOpts.facilitator,
        gateway: opts.gateway,
        relay: globalOpts.relay,
      });
      console.log(`Purchased ${count} tokens`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("balance")
  .description("Show remaining token count")
  .action(async () => {
    try {
      const count = await balanceAction();
      console.log(`Token balance: ${count}`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("clear-tokens")
  .description("Delete all stored privacy pass tokens")
  .action(async () => {
    try {
      const count = await clearTokensAction();
      console.log(`Cleared ${count} tokens`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("gen-payment-key")
  .description("Generate a Solana keypair for payments and print the public key")
  .action(async () => {
    try {
      const { publicKey, keyPath } = await genPaymentKeyAction();
      console.log(`Public key: ${publicKey}`);
      console.log(`Key stored at: ${keyPath}`);
      console.log(`Set PPG_SOLANA_PRIVATE_KEY in your environment to use this key for payments.`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("fund-account")
  .description("Request a SOL airdrop to your payment key on devnet")
  .option("--amount <sol>", "Amount of SOL to request", "2")
  .option("--rpc-url <url>", "Solana RPC URL (fallback)", "https://api.devnet.solana.com")
  .action(async (opts: { amount?: string; rpcUrl?: string }) => {
    try {
      const result = await fundAccountAction({
        amount: parseFloat(opts.amount ?? "2"),
        rpcUrl: opts.rpcUrl,
      });
      if (!result.success) {
        console.error(`Funding failed: ${result.error}`);
        process.exit(1);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();
