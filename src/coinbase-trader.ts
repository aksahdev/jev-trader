import { appendFileSync, mkdirSync } from "node:fs";
import { config } from "./config";
import { CoinbaseFeed, type Book, type Fill, type Quote, type Side, type TradePrint } from "./coinbase";
import type { Action, Decision, Model, TradeState } from "./model";
import { ExternalSignals, type CrossMarketSnapshot } from "./signals";

export interface TraderEvent {
  tick: number;
  /** Alias retained so the original dashboard can still treat decisions as sequential blocks. */
  block: number;
  ts: number;
  market: string;
  mid: number;
  bestBid: number;
  bestAsk: number;
  spreadBps: number;
  signals: CrossMarketSnapshot;
  decision: { action: Action; probabilities: Record<Action, number>; pUp: number; upIn10: number; latencyMs: number; late: boolean } | null;
  quote: Quote | null;
  fill: Fill | null;
  resting: { bidBase: number; askBase: number };
  position: { side: "long" | "short" | "flat"; sizeBase: number; entryPrice: number | null; unrealizedUsd: number };
  totals: Totals;
}

export interface Totals {
  ticks: number;
  decisions: number;
  quotes: number;
  fills: number;
  holds: number;
  lateTicks: number;
  jevUsd: number;
  feesUsd: number;
  realizedUsd: number;
  pnlUsd: number;
  pnlPct: number;
}

interface RestingOrder {
  id: number;
  side: Side;
  price: number;
  size: number;
  remaining: number;
  placedTick: number;
  queueAhead: number;
}

export interface Timing { readMs: number; loopMs: number }

export class CoinbaseTrader {
  readonly history: TraderEvent[] = [];
  private mids: number[] = [];
  private busy = false;
  private tick = 0;
  private nextOrderId = 1;
  private resting: RestingOrder | null = null;
  private tradeCursor = 0;
  private position = { base: 0, costUsd: 0 };
  private totals: Totals = { ticks: 0, decisions: 0, quotes: 0, fills: 0, holds: 0, lateTicks: 0, jevUsd: 0, feesUsd: 0, realizedUsd: 0, pnlUsd: 0, pnlPct: 0 };
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private feed: CoinbaseFeed,
    private model: Model,
    private signals: ExternalSignals,
    private onEvent: (e: TraderEvent, timing?: Timing) => void = () => {},
    private onFill: (tick: number, fill: Fill) => void = () => {},
  ) {
    mkdirSync("data", { recursive: true });
  }

  start() {
    if (this.timer) return;
    void this.onTick();
    this.timer = setInterval(() => void this.onTick(), config.decisionIntervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async onTick() {
    const tick = ++this.tick;
    this.totals.ticks++;
    if (this.busy) {
      this.totals.lateTicks++;
      const book = this.feed.book();
      if (book) this.emit(tick, book, this.signals.snapshot(book.mid), null, null, null, true);
      return;
    }

    this.busy = true;
    const t0 = performance.now();
    try {
      const book = this.feed.book();
      if (!book) throw new Error("Coinbase book unavailable");
      const readMs = performance.now() - t0;
      const crossMarket = this.signals.snapshot(book.mid);

      const batch = this.feed.tradesAfter(this.tradeCursor);
      this.tradeCursor = batch.cursor;
      const fills = this.harvest(batch.trades);
      const fill = fills.length ? aggregate(fills) : null;

      this.mids.push(book.mid);
      const keep = Math.max(400, Math.ceil(config.horizonMs / config.decisionIntervalMs) * 4);
      if (this.mids.length > keep) this.mids.splice(0, this.mids.length - keep);

      const decision = await this.model.decide(this.buildState(tick, book, crossMarket));
      this.totals.decisions++;
      this.totals.jevUsd += (decision.inputTokens / 1e6) * config.jevUsdPerMTok;

      let quote: Quote | null = null;
      if (decision.action === "hold") {
        this.totals.holds++;
        this.resting = null;
      } else {
        const wanted = decision.action as Side;
        const other: Side = wanted === "buy" ? "sell" : "buy";
        const side = this.allowed(wanted) ? wanted : this.allowed(other) ? other : null;
        if (side) {
          const capped = side !== wanted;
          decision.action = side;
          const price = quotePrice(side, book);
          const orderId = this.nextOrderId++;
          this.resting = {
            id: orderId,
            side,
            price,
            size: config.tradeSizeBase,
            remaining: config.tradeSizeBase,
            placedTick: tick,
            queueAhead: queueAheadAtPrice(side, price, book) * config.paperQueueFraction,
          };
          quote = { side, price, size: config.tradeSizeBase, txHash: null, cancel: [], status: "sim", orderId, capped };
          this.totals.quotes++;
        } else {
          this.resting = null;
        }
      }

      this.emit(tick, book, crossMarket, decision, quote, fill, false, { readMs: Math.round(readMs), loopMs: Math.round(performance.now() - t0) });
    } catch (error) {
      console.error(`tick ${tick}:`, (error as Error).message);
    } finally {
      this.busy = false;
    }
  }

  private harvest(trades: TradePrint[]): Fill[] {
    const order = this.resting;
    if (!order || !trades.length) return [];
    const fills: Fill[] = [];
    for (const trade of trades) {
      if (order.remaining <= 1e-12) break;

      // Coinbase documents public market-trade `side` as the MAKER side.
      // A resting buy can only be filled by a trade whose maker side is buy, and vice versa.
      if (trade.side !== order.side) continue;

      const crossed = order.side === "buy" ? trade.price <= order.price : trade.price >= order.price;
      if (!crossed) continue;

      let executable = trade.size;

      // If the print is exactly at our resting price, displayed size that was already there
      // has priority over our newly-posted simulated order. Consume that queue first.
      if (Math.abs(trade.price - order.price) <= config.priceIncrement / 2 && order.queueAhead > 0) {
        const aheadConsumed = Math.min(order.queueAhead, executable);
        order.queueAhead -= aheadConsumed;
        executable -= aheadConsumed;
      }

      // If price printed strictly through our limit, our price level must have traded through.
      // In that case the remaining order is eligible to fill even if the current print is small.
      if (order.side === "buy" ? trade.price < order.price : trade.price > order.price) {
        executable = Math.max(executable, order.remaining);
        order.queueAhead = 0;
      }

      const size = Math.min(order.remaining, executable);
      if (size <= 1e-12) continue;

      const feeUsd = size * order.price * config.paperMakerFeeBps / 10_000;
      const fill: Fill = { side: order.side, size, price: order.price, txHash: null, orderId: order.id, simulated: true, feeUsd };
      order.remaining -= size;
      this.applyFill(fill);
      fills.push(fill);
      this.onFill(this.tick, fill);
    }
    if (order.remaining <= 1e-12) this.resting = null;
    return fills;
  }

  private allowed(side: Side) {
    const next = this.position.base + (side === "buy" ? config.tradeSizeBase : -config.tradeSizeBase);
    return Math.abs(next) <= config.maxPositionBase + 1e-12;
  }

  private buildState(tick: number, book: Book, crossMarket: CrossMarketSnapshot): TradeState {
    const n = this.mids.length;
    const ret = (steps: number) => n > steps ? ((this.mids[n - 1]! - this.mids[n - 1 - steps]!) / this.mids[n - 1 - steps]!) * 10_000 : 0;
    const horizonSteps = Math.max(1, Math.round(config.horizonMs / config.decisionIntervalMs));
    const sampleEvery = Math.max(1, Math.floor(horizonSteps / 20));
    const sampled = this.mids.slice(-horizonSteps).filter((_, i, a) => (a.length - 1 - i) % sampleEvery === 0);
    const trades = this.feed.recentTrades(config.horizonMs);
    const buyBase = trades.filter((t) => t.side === "buy").reduce((s, t) => s + t.size, 0);
    const sellBase = trades.filter((t) => t.side === "sell").reduce((s, t) => s + t.size, 0);
    const vwap = trades.length ? trades.reduce((s, t) => s + t.price * t.size, 0) / trades.reduce((s, t) => s + t.size, 0) : null;
    const depth: TradeState["depth"] = {};
    for (const [band, d] of Object.entries(book.depthBps)) depth[`${band}bps`] = { bid: round(d.bid, 8), ask: round(d.ask, 8) };
    const lvl = ([p, q]: [number, number]) => `${p.toFixed(priceDecimals())} x ${round(q, 8)}`;
    return {
      market: config.productId,
      venue: "coinbase",
      tick,
      horizonMs: config.horizonMs,
      decisionIntervalMs: config.decisionIntervalMs,
      mid: book.mid,
      spreadBps: round(book.spreadBps, 3),
      bookImbalance: round(book.imbalance, 4),
      depth,
      book: { bids: book.levels.bids.map(lvl), asks: book.levels.asks.map(lvl) },
      returnsBps: { last1: round(ret(1), 3), last5: round(ret(5), 3), last20: round(ret(20), 3), horizon: round(ret(horizonSteps), 3) },
      recentMids: sampled.map((x) => x.toFixed(priceDecimals())).join(" "),
      trades: {
        count: trades.length,
        buyBase: round(buyBase, 8),
        sellBase: round(sellBase, 8),
        cvdBase: round(buyBase - sellBase, 8),
        vwap,
        lastPrice: trades.at(-1)?.price ?? null,
        lastSide: trades.at(-1)?.side ?? null,
      },
      recentTrades: trades.slice(-10).map((t) => `${t.side} ${round(t.size, 8)} @ ${t.price.toFixed(priceDecimals())}`),
      crossMarket,
      allowed: { buy: this.allowed("buy"), sell: this.allowed("sell") },
    };
  }

  private applyFill(fill: Fill) {
    const signed = fill.side === "buy" ? fill.size : -fill.size;
    const p = this.position;
    if (p.base === 0 || Math.sign(p.base) === Math.sign(signed)) {
      p.costUsd += signed * fill.price;
    } else {
      const closing = Math.min(Math.abs(signed), Math.abs(p.base)) * Math.sign(signed);
      const entry = p.costUsd / p.base;
      this.totals.realizedUsd += -closing * (fill.price - entry);
      p.costUsd += closing * entry;
      const remainder = signed - closing;
      p.costUsd += remainder * fill.price;
    }
    p.base += signed;
    if (Math.abs(p.base) < 1e-12) { p.base = 0; p.costUsd = 0; }
    this.totals.fills++;
    this.totals.feesUsd += fill.feeUsd;
  }

  private entryPrice() { return this.position.base ? this.position.costUsd / this.position.base : null; }
  private unrealizedUsd(mid: number) { return this.position.base ? this.position.base * (mid - this.entryPrice()!) : 0; }

  private emit(
    tick: number,
    book: Book,
    signals: CrossMarketSnapshot,
    decision: Decision | null,
    quote: Quote | null,
    fill: Fill | null,
    late: boolean,
    timing?: Timing,
  ) {
    const unrealized = this.unrealizedUsd(book.mid);
    this.totals.pnlUsd = this.totals.realizedUsd + unrealized - this.totals.feesUsd;
    this.totals.pnlPct = this.totals.pnlUsd / config.bankrollUsd * 100;
    const event: TraderEvent = {
      tick,
      block: tick,
      ts: Date.now(),
      market: config.productId,
      mid: book.mid,
      bestBid: book.bid,
      bestAsk: book.ask,
      spreadBps: round(book.spreadBps, 3),
      signals,
      decision: late
        ? { action: "hold", probabilities: { buy: 0, sell: 0, hold: 1 }, pUp: 0.5, upIn10: 0.5, latencyMs: 0, late: true }
        : decision && { action: decision.action, probabilities: decision.probabilities, pUp: decision.pUp, upIn10: decision.upIn10, latencyMs: Math.round(decision.latencyMs), late: false },
      quote,
      fill,
      resting: {
        bidBase: this.resting?.side === "buy" ? round(this.resting.remaining, 8) : 0,
        askBase: this.resting?.side === "sell" ? round(this.resting.remaining, 8) : 0,
      },
      position: {
        side: this.position.base > 0 ? "long" : this.position.base < 0 ? "short" : "flat",
        sizeBase: Math.abs(this.position.base),
        entryPrice: this.entryPrice(),
        unrealizedUsd: round(unrealized, 6),
      },
      totals: {
        ...this.totals,
        jevUsd: round(this.totals.jevUsd, 6),
        feesUsd: round(this.totals.feesUsd, 6),
        realizedUsd: round(this.totals.realizedUsd, 6),
        pnlUsd: round(this.totals.pnlUsd, 6),
        pnlPct: round(this.totals.pnlPct, 4),
      },
    };
    this.history.push(event);
    if (this.history.length > config.historySize) this.history.shift();
    appendFileSync("data/events.jsonl", JSON.stringify(event) + "\n");
    this.onEvent(event, timing);
  }
}

function quotePrice(side: Side, book: Book) {
  const tick = config.priceIncrement;
  const inside = Math.max(0, Math.floor(config.quoteInsideTicks)) * tick;
  let price: number;
  if (side === "buy") {
    const candidate = book.bid + inside;
    price = candidate < book.ask ? candidate : book.bid;
  } else {
    const candidate = book.ask - inside;
    price = candidate > book.bid ? candidate : book.ask;
  }
  return Math.round(price / tick) * tick;
}

function queueAheadAtPrice(side: Side, price: number, book: Book) {
  const levels = side === "buy" ? book.levels.bids : book.levels.asks;
  const level = levels.find(([p]) => Math.abs(p - price) <= config.priceIncrement / 2);
  return level?.[1] ?? 0;
}

function priceDecimals() {
  const s = String(config.priceIncrement);
  return s.includes(".") ? s.split(".")[1]!.length : 0;
}

function aggregate(fills: Fill[]): Fill {
  const side = fills[0]!.side;
  const same = fills.filter((f) => f.side === side);
  const size = same.reduce((s, f) => s + f.size, 0);
  const price = same.reduce((s, f) => s + f.price * f.size, 0) / size;
  return { side, size, price, txHash: null, orderId: same[0]!.orderId, simulated: true, feeUsd: same.reduce((s, f) => s + f.feeUsd, 0) };
}

const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;
