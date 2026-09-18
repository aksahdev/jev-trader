# jev-trader — Coinbase paper fork

A Jev-powered short-horizon trading experiment for Coinbase Advanced Trade.

V0 consumes the public Coinbase `level2`, `market_trades`, and `heartbeats` WebSocket channels, asks Jev (or a deterministic mock model) to choose **buy / sell / hold**, and paper-trades one passive maker quote near the touch. It logs decisions, simulated fills, position, fees, and P&L so we can test whether Jev adds edge before enabling real execution.

## Safety boundary

**V0 is paper-only.** `DRY_RUN=false` intentionally refuses to start. No Coinbase API key is required and the code cannot place live orders yet.

## Run

```bash
cp .env.example .env
bun install
bun run start
```

Defaults:

- product: `BTC-USDC`
- decision interval: 1 second
- forecast horizon: 30 seconds
- model: `mock`
- quote size: `0.0001` base asset

To use Jev:

```bash
MODEL=jev
TYPESAFE_AI_API_KEY=...
```

## What the model sees

Each decision includes:

- best bid / ask and spread
- top five book levels
- 10 / 25 / 50 bps depth
- order-book imbalance
- 1 / 5 / 20-step and horizon returns
- recent mids
- recent public trade flow and CVD
- current risk-cap permissions

Jev returns probabilities for `buy`, `sell`, and `hold`. Deterministic code owns the position cap and execution simulation.

## Paper fill model

One passive order rests until the next decision interval. Public trades received after placement can fill it when they print through its price. Fills are capped by observed trade size. This is still an approximation: it does **not** model queue position, hidden liquidity, latency, or exchange-specific matching priority, so paper P&L should be treated as an optimistic research signal rather than deployable alpha.

Set `PAPER_MAKER_FEE_BPS` to your actual Coinbase maker fee tier before judging net results.

## Endpoints

- `GET /` current snapshot
- `GET /history` recent decision ticks
- `GET /events` SSE stream (`snapshot`, `tick`, `quote`, `fill`, `ping`)

Events are also appended to `data/events.jsonl`.

## Main files

```text
src/config.ts           environment/config
src/coinbase.ts         public Coinbase WebSocket feed + in-memory L2 book/trades
src/model.ts            Jev + mock decision models
src/coinbase-trader.ts  paper execution, fills, position and P&L
src/server.ts           snapshot/history/SSE API
src/index.ts            startup
```

The original Monad/Kuru implementation files remain in the fork for reference but are no longer imported by `src/index.ts`.

## Next gates before real money

1. Run long enough to collect a meaningful sample of decisions/fills.
2. Compare Jev to the mock/baseline on the exact same feed.
3. Add realistic queue-position/slippage assumptions and the real maker fee tier.
4. Add walk-forward / replay evaluation and confidence calibration.
5. Only then add authenticated Coinbase order execution behind a separate explicit live flag and hard risk limits.
