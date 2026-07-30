# Private X402 Gateway

Private API consumption using [x402](https://github.com/X402Protocol/x402) payments, [Privacy Pass](https://datatracker.ietf.org/doc/html/rfc9576) tokens, and [OHTTP](https://datatracker.ietf.org/doc/html/rfc9458) relay. No entity can link payments to API usage or client identity.

## Quick Start

```bash
npm install && npm run build && npm run services:up && npm link -w packages/cli
private-pay gen-payment-key
private-pay fund-account
private-pay request http://localhost:3001/api/weather --auto-purchase
```

## CLI

| Command | Description |
|---------|-------------|
| `request <url>` | Private OHTTP request; use `--auto-purchase` to buy tokens on 402 |
| `buy-tokens` | Purchase 1000 tokens explicitly |
| `balance` | Show remaining token count |
| `clear-tokens` | Delete all stored tokens |
| `gen-payment-key` | Generate Solana keypair at `~/.ppg/payment-key.json` |
| `fund-account` | Airdrop SOL on devnet to the payment key |

Global flags: `--facilitator <url>`, `--relay <url>`.

## Settlement Networks

The facilitator settles payments on Solana by default. Set `PPG_CHAIN=casper` to
settle x402 `exact` payments on the Casper Network instead, using wCSPR (a CEP-18
token with 9 decimals, base unit = mote) via the CSPR.cloud x402 facilitator.

| Variable | Default | Description |
|----------|---------|-------------|
| `PPG_CHAIN` | `solana` | Settlement chain: `solana` or `casper` |
| `PPG_CASPER_NETWORK` | `casper:casper-test` | CAIP-2 network: `casper:casper` or `casper:casper-test` |
| `PPG_CASPER_FACILITATOR_URL` | `https://x402-facilitator.cspr.cloud` | x402 facilitator base URL |
| `PPG_CASPER_ACCESS_TOKEN` | — | CSPR.cloud access token |
| `PPG_CASPER_ASSET` | — | wCSPR CEP-18 contract package hash (64 hex chars) |
| `PPG_CASPER_PAY_TO` | — | Recipient account hash (`00` + 64 hex chars) |
| `PPG_PRICE_AMOUNT` | `1000000` | Price in motes |

## Services (Docker)

| Port | Service | Role |
|------|---------|------|
| 3000 | relay | OHTTP proxy, hides client IP |
| 3001 | gateway | Token verification, API access |
| 3002 | facilitator | Payment settlement, token issuance |

## How It Works

See [docs/architecture.md](docs/architecture.md) for the protocol design, PlantUML diagram, and privacy analysis. See [docs/development.md](docs/development.md) for testing and development.
