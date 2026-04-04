# Development

## Commands

```bash
npm run build       # compile TypeScript across all packages
npm run dev         # starts all services with hot-reload (tsx watch)
npm test            # runs all vitest suites across packages
npm run typecheck   # type-check all packages
npm run lint        # lint all packages
```

## Running Services

Services run in Docker via docker compose:

```bash
npm run services:up      # build and start (detached)
npm run services:logs    # stream logs
npm run services:down    # stop and remove
```

Or run without Docker using tsx:

```bash
npm run private-pay -- balance   # runs CLI without linking
```

## Unit Tests

```bash
npm test
```

Runs all vitest suites across packages (`gateway`, `facilitator`, `cli`, `shared`) via Turborepo.

## End-to-End Test

The E2E script (`scripts/e2e-test.ts`) spins up in-memory facilitator and gateway servers on random ports, then exercises the full private token flow:

1. Fetches the issuer's public key
2. Confirms protected endpoints return `402` with a challenge
3. Issues a batch of 1000 blinded tokens
4. Verifies a token grants access and replays are rejected

```bash
npx tsx scripts/e2e-test.ts
```

No external services or Solana wallet required — it uses ephemeral keys in `tmpdir`.

## Key Configuration

Keys are auto-generated on first startup. Pre-generate with:

```bash
npx tsx scripts/setup-keys.ts        # writes to .keys/ (override with KEY_DIR)
```

Custom paths via environment variables:

| Env var | Default | Description |
|---------|---------|-------------|
| `SHARED_KEYS_DIR` | `.keys/` | Base directory for key files |
| `VOPRF_KEY_PATH` | `{SHARED_KEYS_DIR}/voprf.json` | VOPRF key pair |
| `OHTTP_KEY_PATH` | `{SHARED_KEYS_DIR}/ohttp.json` | OHTTP key pair |

In Docker, gateway and facilitator share a named volume (`ppg-keys`) at `/app/.keys`. Whichever starts first generates the keys; the second reads them.

## Solana Payments

The CLI reads the Solana keypair from `~/.ppg/payment-key.json` (created by `gen-payment-key`). When this file exists, the CLI uses real Solana devnet payments. When it doesn't exist, payments are mocked.

```bash
private-pay gen-payment-key          # create keypair at ~/.ppg/payment-key.json
private-pay fund-account             # airdrop SOL on devnet
private-pay buy-tokens --gateway http://localhost:3001   # real devnet payment
```

The CLI warns you which payment mode is active (mock vs Solana devnet).

## CLI (without linking)

```bash
npm run private-pay -- <command> [options]
```
