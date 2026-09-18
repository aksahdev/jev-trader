# jev-trader: Project Plan & Technical Specification

## 1. Intent

The long-term ambition is to build a trading/research system capable of eventually generating **$1,000,000 in cumulative profit**.

That is not the first target.

The project should progress through increasingly difficult proof points:

1. **Make $10** in a way that appears repeatable after realistic costs.
2. **Make $500** without changing the rules after seeing the results.
3. Build enough evidence that scaling capital is rational.
4. Only then treat **$1M** as a serious long-term objective.

The governing principle is:

> Find small, repeatable market inefficiencies; test them ruthlessly; keep only what survives realistic costs and out-of-sample evaluation.

The project is not trying to get rich through one lucky leveraged bet. It is trying to discover, verify, automate, and scale measurable edge.

---

## 2. Core Thesis

Predicting the raw future price of a highly liquid asset is difficult.

More constrained market events may be easier to forecast, especially when they arise from:

- cross-exchange price discovery
- delayed reactions between venues
- market segmentation
- forced flows
- funding/basis mechanics
- liquidity fragmentation
- order-flow imbalance
- temporary deviations between related assets or venues
- deterministic AMM mechanics
- liquidation cascades
- stale or slow-moving pools
- geographically segmented demand such as Korean crypto markets

Therefore the system should not be built as a generic:

> "Will BTC go up?"

bot.

It should become a **multi-market discrepancy detector and conditional probability engine**.

Examples:

- P(Coinbase follows Binance within 2 seconds)
- P(Upbit premium expands or contracts over 30 seconds)
- P(SOL DEX price converges toward CEX consensus)
- P(perpetual basis contracts)
- P(order-flow burst continues)
- P(liquidation pressure creates another forced move)
- P(SHIB follows a DOGE/meme-sector move)
- P(a large exchange inflow creates near-term sell pressure)

Jev is useful when the state can be reduced to bounded questions with explicit probabilities.

---

## 3. Financial Milestones

### Stage 0 — Prove the data pipeline

Target profit: **$0**

Goal:

- collect correct synchronized market data
- prove timestamps and venue mappings are correct
- prove logs are complete
- verify simulated fills are not obviously unrealistic
- establish a repeatable evaluation process

No strategy is considered successful in this phase.

### Stage 1 — Make a credible $10

Target profit: **+$10 simulated first, then +$10 live only after validation**

Requirements:

- positive result after modeled fees
- no look-ahead bias
- no changing strategy parameters mid-test
- positive results across multiple sessions
- no single trade responsible for most of the profit
- maximum drawdown remains inside a predefined limit
- strategy beats at least one simple baseline

The goal is not the amount of money.

The goal is proving that the first dollar was not an accident.

### Stage 2 — Make $500

Target profit: **+$500 cumulative**

Requirements before increasing capital:

- Stage 1 passed
- live execution matches paper behavior reasonably closely
- fees/slippage measured from actual fills
- edge persists across different days and volatility regimes
- strategy remains profitable after conservative execution assumptions
- risk limits are automated
- no manual override is necessary for profitability

This phase should use small enough capital that failure is annoying, not damaging.

### Stage 3 — Scale

Target: progressively larger cumulative P&L

Scaling is allowed only when expected edge, execution capacity, and drawdown behavior support it.

Capital should increase gradually rather than by increasing leverage aggressively.

### Stage 4 — $1M ambition

$1M is treated as the result of:

- one or more verified strategies
- compounding
- increasing capital
- multiple independent sources of edge
- reliable infrastructure
- disciplined risk control

It is not a deadline and not a guarantee.

---

## 4. Current V0 Scope

### Execution/reference venue

**Coinbase**

Current mode:

- public market data only
- paper execution only
- no live trading keys
- no withdrawals
- no authenticated execution

### Signal venues

**Binance Spot**

Inputs:

- best bid / ask
- midpoint
- difference from Coinbase
- aggressive trades
- 1s / 5s / 30s returns
- 5-second buy volume
- 5-second sell volume
- CVD

**Upbit Korea**

Inputs:

- KRW asset order book
- public trades
- KRW-USDT market
- implied USD/USDT-normalized asset price
- premium/discount versus Coinbase
- 1s / 5s / 30s returns
- 5-second buy/sell flow
- CVD

### Initial assets

1. BTC
2. SOL
3. SHIB

These serve different purposes:

- **BTC:** control / highly efficient benchmark
- **SOL:** connected CEX + DeFi + perp + on-chain ecosystem
- **SHIB:** retail / meme / Korea / whale-flow / cross-venue experiment

---

## 5. System Architecture

```text
                       ┌─────────────────┐
                       │  Binance Spot   │
                       │ book + trades   │
                       └────────┬────────┘
                                │
                                │
┌─────────────────┐             │
│  Upbit Korea    │─────────────┤
│ book + trades   │             │
│ + KRW-USDT      │             │
└─────────────────┘             ▼
                         ┌──────────────┐
                         │ Signal Layer │
                         │ normalize    │
                         │ timestamp    │
                         │ derive       │
                         └──────┬───────┘
                                │
                                │
┌─────────────────┐             ▼
│ Coinbase        │      ┌──────────────┐
│ L2 + trades     │─────>│ State Builder│
└─────────────────┘      └──────┬───────┘
                                │
                                ▼
                         ┌──────────────┐
                         │ Jev / Mock   │
                         │ buy/sell/hold│
                         │ probabilities│
                         └──────┬───────┘
                                │
                                ▼
                         ┌──────────────┐
                         │ Risk Engine  │
                         │ deterministic│
                         └──────┬───────┘
                                │
                                ▼
                         ┌──────────────┐
                         │ Paper Exec   │
                         │ maker quote  │
                         └──────┬───────┘
                                │
                                ▼
                         ┌──────────────┐
                         │ Event Log    │
                         │ JSONL + SSE  │
                         └──────────────┘
```

The model must never directly control risk limits.

Risk remains deterministic.

---

## 6. Jev Decision Contract

Jev should return bounded decisions rather than free-form trading prose.

Primary action:

- buy
- sell
- hold

Required outputs:

- probability of buy
- probability of sell
- probability of hold
- inference latency
- token usage

Future specialized questions may include:

- P(Coinbase follows Binance within X seconds)
- P(Upbit move propagates to Coinbase)
- P(Korean premium mean-reverts)
- P(Korean premium continues expanding)
- P(current flow continues)
- P(spread closes)
- P(perp basis converges)
- P(liquidation cascade continues)
- P(SOL DEX price catches up to CEX consensus)
- P(SHIB follows DOGE or meme-sector momentum)

The model should be allowed to say **hold** frequently.

Forcing a trade every interval is not a requirement.

---

## 7. Baselines

Jev is not considered useful merely because it produces profit.

It must beat simpler alternatives.

Required baselines:

### Baseline A — Random

Random buy/sell/hold with the same approximate activity rate.

### Baseline B — Coinbase-only heuristic

Uses:

- Coinbase return
- order-book imbalance
- Coinbase trade flow

### Baseline C — Cross-market deterministic heuristic

Uses:

- Binance return
- Binance-Coinbase spread
- Upbit return
- Korean premium
- cross-venue CVD

### Model D — Jev Coinbase-only

Jev without external venue information.

### Model E — Jev cross-market

Jev with Coinbase + Binance + Upbit.

Later:

### Model F — Jev + Hyperliquid

Adds:

- mark price
- oracle price
- funding
- OI
- perp/spot basis
- liquidation-related state

### Model G — Jev + Solana ecosystem

Adds:

- Jupiter
- Raydium
- Orca
- Meteora
- Drift
- Pyth
- Solana transaction/liquidity state

---

## 8. Evaluation Method

### Never judge a strategy from a single P&L number

For every model/strategy, record:

- total P&L
- P&L after fees
- P&L after conservative simulated slippage
- number of decisions
- number of quotes
- number of fills
- win rate
- average win
- average loss
- profit factor
- maximum drawdown
- return volatility
- average holding period
- exposure
- fill rate
- Jev inference cost
- P&L per 1,000 decisions
- P&L per hour
- P&L per dollar of capital
- performance by confidence bucket

### Prediction-specific metrics

Also measure:

- Brier score
- calibration
- accuracy by probability bucket
- precision when confidence exceeds threshold
- actual return after prediction horizon
- venue lead/lag correlation
- conditional return after cross-market divergence

Example:

```text
Jev says:
P(up) = 0.74

Collect every 0.70–0.80 prediction.

If the system is calibrated,
roughly 70–80% of comparable outcomes
should behave as predicted.
```

Calibration matters because a probability model can support threshold-based trading.

---

## 9. Train / Validation / Test Discipline

Do not repeatedly tune parameters on the same period and then call it successful.

Data should be divided chronologically.

Example:

```text
Period A
research / exploration

Period B
parameter selection

Period C
untouched validation

Period D
final test
```

Once a test period is designated, do not alter the strategy using knowledge from that period.

A strategy that looks excellent in historical replay but fails forward testing is rejected.

---

## 10. Paper Execution Requirements

Current fill simulation is intentionally simple.

Before trusting P&L, add:

- queue-position assumptions
- partial fills
- latency
- maker/taker fees
- minimum order sizes
- exchange tick sizes
- cancellation latency
- missed fills
- adverse selection
- realistic spread capture
- price movement during inference

Use at least three execution assumptions:

### Optimistic

Current basic simulated fills.

### Realistic

Conservative queue/latency assumptions.

### Hostile

Worse-than-expected fills and higher effective costs.

A strategy should ideally remain interesting under the realistic model.

---

## 11. Risk Rules

When live execution is eventually added:

### Hard rules

- withdrawal permission disabled on API keys
- trading key separate from normal account credentials
- smallest practical initial position size
- maximum position
- maximum order size
- maximum daily loss
- maximum strategy drawdown
- maximum number of open orders
- stale-data kill switch
- exchange-disconnect kill switch
- model-error kill switch
- unexpected-position kill switch
- API failure kill switch
- clock/timestamp sanity checks

### Forbidden behavior

The bot must not:

- increase leverage to recover a loss
- double position size after losing trades
- disable risk limits automatically
- trade when required market data are stale
- trade when execution state is uncertain
- send withdrawals
- expose API secrets to logs

---

## 12. Asset Experiment Matrix

### BTC

Purpose:

- control asset
- establish baseline market efficiency
- measure Binance/Coinbase lead-lag
- measure Korean premium usefulness

Questions:

- Does Binance lead Coinbase at 1–5 second horizons?
- Does Upbit add information after controlling for Binance?
- Does Jev improve over deterministic OFI?

### SOL

Purpose:

- bridge centralized and decentralized market structures
- eventually incorporate Solana DEX/perp/oracle state

Phase 1:

- Coinbase
- Binance
- Upbit

Phase 2:

- Hyperliquid
- Drift
- Jupiter
- Raydium
- Orca
- Meteora
- Pyth

Questions:

- Which venue leads during high volatility?
- Do DEX/CEX divergences predict convergence?
- Does perp funding/basis improve spot prediction?
- Can liquidation state predict short bursts?

### SHIB

Purpose:

- retail/meme market behavior
- Korean participation
- cross-exchange lag
- eventual whale/exchange-flow analysis

Phase 1:

- Coinbase
- Binance
- Upbit

Phase 2:

- Ethereum transfers
- exchange wallet flows
- Shibarium
- ShibaSwap
- DOGE / meme-sector reference basket

Questions:

- Does Korean SHIB flow lead North American venues?
- Does DOGE/meme-sector movement propagate into SHIB?
- Do exchange deposits from large holders contain predictive value?
- Are extreme Korean premiums mean-reverting or trend-following by regime?

---

## 13. Address Classification for Future SHIB Analysis

Large balances must be classified before being treated as whale holdings.

Categories:

- burn address
- exchange custody
- bridge
- liquidity pool
- smart contract
- externally owned account
- market maker
- known team/treasury
- unknown

Interesting event:

```text
long-dormant EOA
      ↓
large SHIB transfer
      ↓
known exchange deposit
      ↓
exchange inventory rises
      ↓
sell-side pressure appears
      ↓
measure conditional forward return
```

Raw concentration statistics alone are not trading signals.

---

## 14. Future Signal Sources

Priority order:

### Priority 1 — already being built

- Coinbase
- Binance
- Upbit

### Priority 2 — Hyperliquid

Reason:

Very high information density for little integration cost.

Potential fields:

- order book
- trades
- mark
- oracle
- funding
- open interest
- perp/spot premium

### Priority 3 — Solana

Potential sources:

- Jupiter
- Raydium
- Orca
- Meteora
- Drift
- Pyth
- public Solana RPC

Initial goal:

collect synchronized states, not execute.

### Priority 4 — Ethereum / SHIB on-chain

Potential signals:

- exchange inflows/outflows
- whale movement
- DEX price divergence
- liquidity changes
- bridge activity
- Shibarium activity

---

## 15. Research Backlog

Potential experiments:

1. Binance → Coinbase lead/lag
2. Upbit → Coinbase lead/lag
3. Coinbase → Upbit lead/lag
4. Korean premium regime classification
5. order-flow continuation
6. spread convergence
7. perp/spot convergence
8. funding prediction
9. liquidation cascade continuation
10. SOL CEX ↔ DEX convergence
11. stale pool detection
12. SHIB/DOGE lead-lag
13. SHIB whale-to-exchange flow
14. stablecoin premium signals
15. cross-asset propagation
16. volatility regime gating
17. confidence-threshold trading
18. no-trade/hold optimization

Experiments should be added one at a time when possible so we can identify what actually improves results.

---

## 16. Data Requirements

Each observation should include:

- UTC timestamp
- local monotonic sequence/tick
- source timestamp when available
- receive timestamp
- venue
- product
- bid
- ask
- mid
- depth
- flow statistics
- recent returns
- cross-market spreads
- model inputs
- model outputs
- probabilities
- inference latency
- simulated order
- fill outcome
- realized forward return after selected horizons

Required forward labels should eventually include:

- +1s
- +2s
- +5s
- +10s
- +30s
- +60s

This allows strategies to be evaluated after the fact without rerunning the market.

---

## 17. Observability

Console should make failures obvious.

Examples:

- connection established
- subscription confirmed
- snapshot received
- stale venue
- reconnecting
- model latency
- skipped decision
- quote generated
- fill simulated
- risk rejection

Silent failures are unacceptable for market-data infrastructure.

---

## 18. Reproducibility

Every experiment should record:

- git commit SHA
- configuration
- model ID
- model provider
- prompt/question version
- asset
- venue set
- start/end timestamps
- fee assumptions
- execution model version

An impressive P&L that cannot be reproduced is not evidence.

---

## 19. Go / No-Go Rules

### Continue a signal when

- it works out-of-sample
- it survives costs
- it is stable across multiple days
- it has a plausible mechanism
- results are not dominated by one event
- predictive calibration is useful

### Kill or pause a signal when

- edge disappears after fees
- only one asset/time period works
- performance depends on hindsight tuning
- tiny parameter changes destroy results
- simulated execution assumptions are unrealistic
- signal source is too unreliable/expensive for the edge

Failing quickly is good.

It prevents us from wasting months on a false edge.

---

## 20. Scaling Rules

Do not jump directly from paper trading to meaningful capital.

Suggested conceptual sequence:

```text
paper
  ↓
tiny live
  ↓
prove +$10
  ↓
repeat
  ↓
larger but still disposable allocation
  ↓
prove cumulative +$500
  ↓
measure capacity
  ↓
scale gradually
```

Position size should be determined by:

- observed drawdown
- edge confidence
- liquidity
- fill quality
- strategy capacity
- correlation with other strategies

not excitement.

---

## 21. Definition of "Working"

The project is **not working** merely because:

- the dashboard is green
- Jev sounds intelligent
- a backtest is profitable
- one night makes money
- one coin performs well

The project becomes interesting when:

1. data are correct
2. probabilities are calibrated
3. a strategy beats simple baselines
4. results survive unseen data
5. results survive realistic costs
6. tiny live trading resembles simulation
7. profitability repeats

Only then do we discuss serious scaling.

---

## 22. Immediate Next Steps

### Now

1. Run BTC in mock mode.
2. Verify Coinbase, Binance, and Upbit feeds.
3. Confirm no signal remains silently stale.
4. Collect a small clean event sample.
5. Inspect the resulting JSONL.

### Next

6. Run the identical setup with Jev.
7. Record Jev probabilities and latency.
8. Compare Jev to the deterministic baseline.
9. Add forward-return labels and an evaluation script.
10. Repeat on SOL.
11. Repeat on SHIB.

### After that

12. Add Hyperliquid.
13. Run ablations:
    - Coinbase only
    - + Binance
    - + Upbit
    - + Hyperliquid
14. Add replay/backtesting.
15. Improve paper execution realism.
16. Decide whether any strategy deserves a tiny live test.

---

## 23. First Money Objective

The first meaningful target is **not $1M**.

It is:

> Make the first $10 in a way we can explain, reproduce, and reasonably expect to repeat.

Then:

> Make $500 without abandoning the process that produced the first $10.

If we can do those two things while controlling drawdown and resisting hindsight tuning, the $1M ambition becomes an engineering/scaling problem rather than a lottery ticket.
