# Private Payments Gateway

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

## Services (Docker)

| Port | Service | Role |
|------|---------|------|
| 3000 | relay | OHTTP proxy, hides client IP |
| 3001 | gateway | Token verification, API access |
| 3002 | facilitator | Payment settlement, token issuance |

## How It Works

See [docs/architecture.md](docs/architecture.md) for the protocol design, PlantUML diagram, and privacy analysis. See [docs/development.md](docs/development.md) for testing and development.
