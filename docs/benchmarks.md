# Benchmarks

Measure token issuance latency, per-request latency, and throughput. Requires services running (`npm run services:up`).

## Commands

```bash
ppg benchmark issue [--iterations N] [--no-relay]
ppg benchmark request --count N [--no-relay]
ppg benchmark full [--no-relay]
```

## Token Issuance

```bash
ppg benchmark issue --iterations 5
```

Times the full pay-and-receive flow, broken into sub-phases:

| Phase | What's measured |
|-------|----------------|
| `fetch-keys` | Fetch facilitator OHTTP keys |
| `get-challenge` | GET gateway 402 for Privacy Pass challenge |
| `blind` | Local VOPRF blinding of 1000 token inputs |
| `payment` | Local x402 payment payload creation |
| `issue-request` | POST to facilitator: payment + blinded elements → evaluated elements + DLEQ proof |
| `finalize` | Local DLEQ proof verification + token unblinding |

Runs N iterations (default 5) and reports per-phase timing plus aggregate mean/median/p95.

## Single Request

```bash
ppg benchmark request --count 1
```

Times one token-bearing API request. Requires tokens to exist (`ppg buy-tokens` first).

## Batch Requests

```bash
ppg benchmark request --count 1000
```

Times 1000 sequential token-bearing requests. Reports per-request stats (mean, median, p95, p99, throughput).

## Full Pipeline

```bash
ppg benchmark full
```

Runs all three: issue, single request, 1000 requests.

## Direct Mode

`--no-relay` bypasses OHTTP and hits gateway/facilitator directly. Use this to isolate service-only latency from relay overhead.

```bash
ppg benchmark full --no-relay
```

## Sample Output

```
=== Token Issuance (5 iterations) ===

  fetch-keys                  12.3 ms
  get-challenge               8.1 ms
  blind                       3.2 ms
  payment                     0.1 ms
  issue-request             245.7 ms
  finalize                    1.8 ms
  ──────────────────────── ────────────
  Total                     271.2 ms

=== 1000 Sequential Requests ===

  Requests:        1000
  Mean:            8.4 ms
  Median:          7.9 ms
  P95:             12.1 ms
  P99:             18.3 ms
  Throughput:      119.0 req/s
```
