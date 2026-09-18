import { config } from "./config";

type Side = "buy" | "sell";

interface TimedMid { ts: number; mid: number }
interface TimedTrade { ts: number; side: Side; price: number; size: number }

export interface VenueSignal {
  mid: number | null;
  ageMs: number | null;
  deltaVsCoinbaseBps: number | null;
  return1sBps: number | null;
  return5sBps: number | null;
  return30sBps: number | null;
  buyBase5s: number;
  sellBase5s: number;
  cvdBase5s: number;
}

export interface UpbitSignal extends VenueSignal {
  krwMid: number | null;
  usdtKrw: number | null;
  impliedUsd: number | null;
  premiumVsCoinbaseBps: number | null;
}

export interface CrossMarketSnapshot {
  baseAsset: string;
  binance: VenueSignal | null;
  upbit: UpbitSignal | null;
}

/** Public Binance Spot bookTicker + aggTrade feed. No API key required. */
class BinanceSignalFeed {
  private socket: WebSocket | null = null;
  private running = false;
  private reconnectMs = 500;
  private bid: number | null = null;
  private ask: number | null = null;
  private updatedAt = 0;
  private mids: TimedMid[] = [];
  private trades: TimedTrade[] = [];

  start() {
    if (this.running || !config.binanceSignals) return;
    this.running = true;
    this.connect(0);
  }

  stop() {
    this.running = false;
    this.socket?.close();
    this.socket = null;
  }

  snapshot(coinbaseMid: number, now = Date.now()): VenueSignal | null {
    const mid = this.currentMid();
    if (mid === null) return null;
    const recent = this.trades.filter((t) => t.ts >= now - 5000);
    const buyBase5s = recent.filter((t) => t.side === "buy").reduce((s, t) => s + t.size, 0);
    const sellBase5s = recent.filter((t) => t.side === "sell").reduce((s, t) => s + t.size, 0);
    return {
      mid,
      ageMs: this.updatedAt ? now - this.updatedAt : null,
      deltaVsCoinbaseBps: coinbaseMid > 0 ? ((mid - coinbaseMid) / coinbaseMid) * 10_000 : null,
      return1sBps: this.ret(now, 1000),
      return5sBps: this.ret(now, 5000),
      return30sBps: this.ret(now, 30_000),
      buyBase5s,
      sellBase5s,
      cvdBase5s: buyBase5s - sellBase5s,
    };
  }

  private currentMid() {
    return this.bid !== null && this.ask !== null && this.ask > this.bid ? (this.bid + this.ask) / 2 : null;
  }

  private connect(delayMs: number) {
    setTimeout(() => {
      if (!this.running) return;
      const symbol = config.binanceSymbol.toLowerCase();
      const url = `${config.binanceWsBase}/stream?streams=${symbol}@bookTicker/${symbol}@aggTrade`;
      const ws = new WebSocket(url);
      this.socket = ws;
      ws.onopen = () => { this.reconnectMs = 500; };
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          const data = message.data ?? message;
          if (data.e === "bookTicker") {
            const bid = Number(data.b);
            const ask = Number(data.a);
            if (Number.isFinite(bid) && Number.isFinite(ask) && ask > bid) {
              this.bid = bid;
              this.ask = ask;
              this.updatedAt = Date.now();
              this.pushMid(this.updatedAt, (bid + ask) / 2);
            }
          } else if (data.e === "aggTrade") {
            const price = Number(data.p);
            const size = Number(data.q);
            const ts = Number(data.T ?? data.E ?? Date.now());
            // m=true means the buyer was the maker, so the aggressor was a seller.
            const side: Side = data.m ? "sell" : "buy";
            if (Number.isFinite(price) && Number.isFinite(size) && size > 0) {
              this.trades.push({ ts, side, price, size });
              this.trim(ts);
            }
          }
        } catch {}
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (!this.running) return;
        const delay = this.reconnectMs;
        this.reconnectMs = Math.min(this.reconnectMs * 2, 10_000);
        this.connect(delay);
      };
    }, delayMs);
  }

  private pushMid(ts: number, mid: number) {
    const last = this.mids.at(-1);
    if (!last || ts - last.ts >= 100) this.mids.push({ ts, mid });
    this.trim(ts);
  }

  private trim(now: number) {
    const cutoff = now - 60_000;
    while (this.mids.length && this.mids[0]!.ts < cutoff) this.mids.shift();
    while (this.trades.length && this.trades[0]!.ts < cutoff) this.trades.shift();
  }

  private ret(now: number, windowMs: number) {
    const current = this.currentMid();
    if (current === null) return null;
    const cutoff = now - windowMs;
    let past: TimedMid | undefined;
    for (let i = this.mids.length - 1; i >= 0; i--) {
      if (this.mids[i]!.ts <= cutoff) { past = this.mids[i]; break; }
    }
    return past?.mid ? ((current - past.mid) / past.mid) * 10_000 : null;
  }
}

/** Public Korean Upbit orderbook + trade feed, normalized with KRW-USDT. No API key required. */
class UpbitSignalFeed {
  private socket: WebSocket | null = null;
  private running = false;
  private reconnectMs = 500;
  private assetBid: number | null = null;
  private assetAsk: number | null = null;
  private usdtBid: number | null = null;
  private usdtAsk: number | null = null;
  private updatedAt = 0;
  private mids: TimedMid[] = [];
  private trades: TimedTrade[] = [];
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  start() {
    if (this.running || !config.upbitSignals) return;
    this.running = true;
    this.connect(0);
  }

  stop() {
    this.running = false;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.socket?.close();
    this.socket = null;
  }

  snapshot(coinbaseMid: number, now = Date.now()): UpbitSignal | null {
    const krwMid = this.mid(this.assetBid, this.assetAsk);
    const usdtKrw = this.mid(this.usdtBid, this.usdtAsk);
    const impliedUsd = krwMid !== null && usdtKrw !== null && usdtKrw > 0 ? krwMid / usdtKrw : null;
    if (krwMid === null && impliedUsd === null) return null;

    const recent = this.trades.filter((t) => t.ts >= now - 5000);
    const buyBase5s = recent.filter((t) => t.side === "buy").reduce((s, t) => s + t.size, 0);
    const sellBase5s = recent.filter((t) => t.side === "sell").reduce((s, t) => s + t.size, 0);
    const delta = impliedUsd !== null && coinbaseMid > 0 ? ((impliedUsd - coinbaseMid) / coinbaseMid) * 10_000 : null;

    return {
      mid: impliedUsd,
      ageMs: this.updatedAt ? now - this.updatedAt : null,
      deltaVsCoinbaseBps: delta,
      return1sBps: this.ret(now, 1000),
      return5sBps: this.ret(now, 5000),
      return30sBps: this.ret(now, 30_000),
      buyBase5s,
      sellBase5s,
      cvdBase5s: buyBase5s - sellBase5s,
      krwMid,
      usdtKrw,
      impliedUsd,
      premiumVsCoinbaseBps: delta,
    };
  }

  private connect(delayMs: number) {
    setTimeout(() => {
      if (!this.running) return;
      const ws = new WebSocket(config.upbitWsUrl);
      this.socket = ws;
      ws.onopen = () => {
        this.reconnectMs = 500;
        ws.send(JSON.stringify([
          { ticket: "jev-trader-cross-market" },
          { type: "orderbook", codes: [config.upbitAssetCode, config.upbitFxCode] },
          { type: "trade", codes: [config.upbitAssetCode] },
          { format: "DEFAULT" },
        ]));
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
          try { if (ws.readyState === WebSocket.OPEN) ws.send("PING"); } catch {}
        }, 30_000);
      };
      ws.onmessage = (event) => {
        try {
          const raw = event.data;
          const text = typeof raw === "string"
            ? raw
            : raw instanceof ArrayBuffer
              ? new TextDecoder().decode(raw)
              : String(raw);
          if (text === "UP") return;
          const data = JSON.parse(text);
          if (data.type === "orderbook") {
            const unit = data.orderbook_units?.[0];
            if (!unit) return;
            const bid = Number(unit.bid_price);
            const ask = Number(unit.ask_price);
            if (!Number.isFinite(bid) || !Number.isFinite(ask) || ask < bid) return;
            if (data.code === config.upbitAssetCode) {
              this.assetBid = bid; this.assetAsk = ask;
            } else if (data.code === config.upbitFxCode) {
              this.usdtBid = bid; this.usdtAsk = ask;
            }
            this.updatedAt = Date.now();
            const implied = this.impliedUsd();
            if (implied !== null) this.pushMid(this.updatedAt, implied);
          } else if (data.type === "trade" && data.code === config.upbitAssetCode) {
            const price = Number(data.trade_price);
            const size = Number(data.trade_volume);
            const ts = Number(data.trade_timestamp ?? data.timestamp ?? Date.now());
            const side: Side = String(data.ask_bid).toUpperCase() === "BID" ? "buy" : "sell";
            if (Number.isFinite(price) && Number.isFinite(size) && size > 0) {
              this.trades.push({ ts, side, price, size });
              this.trim(ts);
            }
          }
        } catch {}
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = null;
        if (!this.running) return;
        const delay = this.reconnectMs;
        this.reconnectMs = Math.min(this.reconnectMs * 2, 10_000);
        this.connect(delay);
      };
    }, delayMs);
  }

  private impliedUsd() {
    const asset = this.mid(this.assetBid, this.assetAsk);
    const fx = this.mid(this.usdtBid, this.usdtAsk);
    return asset !== null && fx !== null && fx > 0 ? asset / fx : null;
  }

  private mid(bid: number | null, ask: number | null) {
    return bid !== null && ask !== null && ask >= bid ? (bid + ask) / 2 : null;
  }

  private pushMid(ts: number, mid: number) {
    const last = this.mids.at(-1);
    if (!last || ts - last.ts >= 100) this.mids.push({ ts, mid });
    this.trim(ts);
  }

  private trim(now: number) {
    const cutoff = now - 60_000;
    while (this.mids.length && this.mids[0]!.ts < cutoff) this.mids.shift();
    while (this.trades.length && this.trades[0]!.ts < cutoff) this.trades.shift();
  }

  private ret(now: number, windowMs: number) {
    const current = this.impliedUsd();
    if (current === null) return null;
    const cutoff = now - windowMs;
    let past: TimedMid | undefined;
    for (let i = this.mids.length - 1; i >= 0; i--) {
      if (this.mids[i]!.ts <= cutoff) { past = this.mids[i]; break; }
    }
    return past?.mid ? ((current - past.mid) / past.mid) * 10_000 : null;
  }
}

export class ExternalSignals {
  private binance = new BinanceSignalFeed();
  private upbit = new UpbitSignalFeed();

  start() {
    this.binance.start();
    this.upbit.start();
  }

  stop() {
    this.binance.stop();
    this.upbit.stop();
  }

  snapshot(coinbaseMid: number): CrossMarketSnapshot {
    const now = Date.now();
    const fresh = <T extends VenueSignal>(value: T | null): T | null =>
      value?.ageMs !== null && value.ageMs! <= config.signalMaxAgeMs ? value : null;

    return {
      baseAsset: config.baseAsset,
      binance: fresh(this.binance.snapshot(coinbaseMid, now)),
      upbit: fresh(this.upbit.snapshot(coinbaseMid, now)),
    };
  }
}
