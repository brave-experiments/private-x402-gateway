#!/usr/bin/env node
import { Command } from "commander";
import { requestAction } from "./commands/request.js";
import { buyTokensAction } from "./commands/buy-tokens.js";
import { balanceAction } from "./commands/balance.js";
import { clearTokensAction } from "./commands/clear-tokens.js";
import { genPaymentKeyAction } from "./commands/gen-payment-key.js";
import { fundAccountAction } from "./commands/fund-account.js";
import { benchmarkIssue } from "./commands/benchmark/issue.js";
import { benchmarkRequest } from "./commands/benchmark/request.js";
import { benchmarkFull } from "./commands/benchmark/full.js";

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

program
  .command("benchmark")
  .description("Benchmark token issuance and request performance")
  .option("--no-relay", "Bypass OHTTP relay, hit services directly")
  .addCommand(
    new Command("issue")
      .description("Benchmark token issuance flow")
      .option("--iterations <n>", "Number of iterations", "5")
      .action(async (opts) => {
        const globalOpts = program.opts();
        const benchOpts = program.commands.find((c) => c.name() === "benchmark")!.opts();
        try {
          await benchmarkIssue({
            facilitator: globalOpts.facilitator,
            relay: globalOpts.relay,
            noRelay: benchOpts.noRelay,
            iterations: parseInt(opts.iterations, 10),
          });
        } catch (err) {
          console.error(err instanceof Error ? err.message : err);
          process.exit(1);
        }
      }),
  )
  .addCommand(
    new Command("request")
      .description("Benchmark token-bearing requests")
      .option("--count <n>", "Number of requests", "1")
      .action(async (opts) => {
        const globalOpts = program.opts();
        const benchOpts = program.commands.find((c) => c.name() === "benchmark")!.opts();
        try {
          await benchmarkRequest({
            relay: globalOpts.relay,
            noRelay: benchOpts.noRelay,
            count: parseInt(opts.count, 10),
          });
        } catch (err) {
          console.error(err instanceof Error ? err.message : err);
          process.exit(1);
        }
      }),
  )
  .addCommand(
    new Command("full")
      .description("Run full benchmark: issue + single request + 1000 requests")
      .action(async () => {
        const globalOpts = program.opts();
        const benchOpts = program.commands.find((c) => c.name() === "benchmark")!.opts();
        try {
          await benchmarkFull({
            facilitator: globalOpts.facilitator,
            relay: globalOpts.relay,
            noRelay: benchOpts.noRelay,
          });
        } catch (err) {
          console.error(err instanceof Error ? err.message : err);
          process.exit(1);
        }
      }),
  );

program.parse();
