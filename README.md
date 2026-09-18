# jev-trader — Coinbase paper + cross-market signals

A Jev-powered short-horizon trading experiment.

Coinbase remains the **paper execution/reference venue**. Binance Spot and Korean Upbit run as **keyless signal venues**. Every decision records the exact cross-market snapshot that Jev saw, so we can later measure whether those signals actually improve out-of-sample results.

## Safety boundary

**V0 is paper-only.** `DRY_RUN=false` intentionally refuses to start. No Coinbase, Binance, or Upbit trading credentials are used.

## Data path

```text
Binance BTC/SOL/SHIB USDT ─┐
                           ├─> cross-market snapshot ─┐
Upbit KRW asset + KRW-USDT ┘                         │
                                                     ├─> Jev/mock ─> paper quote
Coinbase L2 + trades ────────────────────────────────┘
```

For Upbit, the asset's KRW midpoint is divided by the `KRW-USDT` midpoint to create an approximate dollar-normalized Korean price. That lets us measure Korean premium/discount and short-term Korean returns without adding an FX API key.

## Run

```bash
git checkout coinbase-paper-v0
cp .env.example .env
bun install
bun run start
```

Defaults:

- Coinbase: `BTC-USDC`
- Binance signal: `BTCUSDT`
- Upbit signal: `KRW-BTC`, normalized with `KRW-USDT`
- decision interval: 1 second
- forecast horizon: 30 seconds
- model: `mock`

To use Jev:

```env
MODEL=jev
TYPESAFE_AI_API_KEY=...
```

## BTC / SOL / SHIB

The signal mappings are inferred from `PRODUCT_ID`. Example configurations are included at the bottom of `.env.example`.

Typical experiments:

```text
BTC:  Coinbase BTC-USDC  vs Binance BTCUSDT  vs Upbit KRW-BTC
SOL:  Coinbase SOL-USDC  vs Binance SOLUSDT  vs Upbit KRW-SOL
SHIB: Coinbase SHIB-USD  vs Binance SHIBUSDT vs Upbit KRW-SHIB
```

For SHIB, verify the exact Coinbase product and tick size visible to your account before running; the sample values are configuration examples, not an exchange guarantee.

## What Jev sees

### Coinbase
- best bid / ask and spread
- top five book levels
- 10 / 25 / 50 bps depth
- order-book imbalance
- 1 / 5 / 20-step and horizon returns
- public aggressive trade flow / CVD
- current position-cap permissions

### Binance
- best bid/ask midpoint
- price difference vs Coinbase in bps
- 1s / 5s / 30s returns
- 5-second aggressive buy/sell flow and CVD

### Korean Upbit
- KRW market midpoint
- live `KRW-USDT` midpoint
- approximate USDT-normalized asset price
- Korean premium/discount vs Coinbase
- 1s / 5s / 30s returns
- 5-second aggressive buy/sell flow and CVD

Snapshots older than `SIGNAL_MAX_AGE_MS` are removed before the model sees them.

## Logging

Each tick is appended to `data/events.jsonl` and includes:

- Coinbase market state
- the exact Binance/Upbit signal snapshot
- Jev/mock probabilities
- paper quote/fill
- position
- fees and P&L

This is important: we can later replay the data and compare Coinbase-only vs Coinbase+Binance vs Coinbase+Upbit rather than relying on anecdotes.

## Endpoints

- `GET /` current snapshot
- `GET /history` recent decision ticks
- `GET /events` SSE stream

## Main files

```text
src/config.ts           environment/config
src/coinbase.ts         Coinbase public L2 + trades
src/signals.ts          Binance + Korean Upbit public signal feeds
src/model.ts            Jev + deterministic comparison model
src/coinbase-trader.ts  paper execution, logging, position and P&L
src/server.ts           snapshot/history/SSE API
src/index.ts            startup
```

The original Monad/Kuru implementation remains in the fork for reference but is no longer on the active startup path.

## Before real money

1. Collect a substantial dataset on BTC, SOL and SHIB.
2. Replay identical periods with external signals removed.
3. Measure hit rate and P&L by Jev confidence bucket.
4. Add realistic queue position, slippage and the real Coinbase maker fee.
5. Add Hyperliquid/Solana signals only if they improve validation results.
6. Only after that consider authenticated execution behind explicit live flags and hard loss limits.
