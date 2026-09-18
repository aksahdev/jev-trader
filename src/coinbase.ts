import { config } from "./config";

export type Side = "buy" | "sell";
export type Level = [price: number, size: number];

export interface Book {
  bid: number;
  ask: number;
  mid: number;
  spreadBps: number;
  imbalance: number;
  levels: { bids: Level[]; asks: Level[] };
  depthBps: Record<string, { bid: number; ask: number }>;
  updatedAt: number;
}

export interface TradePrint {
  seq: number;
  tradeId: string;
  ts: number;
  side: Side;
  price: number;
  size: number;
}

export interface Quote {
  side: Side;
  price: number;
  size: number;
  txHash: null;
  cancel: number[];
  status: "sim";
  orderId: number;
  capped: boolean;
}

export interface Fill {
  side: Side;
  size: number;
  price: number;
  txHash: null;
  orderId: number;
  simulated: true;
  feeUsd: number;
}

type WsMessage = {
  channel?: string;
  timestamp?: string;
  events?: Array<Record<string, any>>;
};

/** Public Coinbase Advanced Trade feed: level2 + market_trades + heartbeats. */
export class CoinbaseFeed {
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();
  private trades: TradePrint[] = [];
  private seenTradeIds = new Set<string>();
  private tradeSeq = 0;
  private socket: WebSocket | null = null;
  private running = false;
  private reconnectMs = 500;
  private lastBookUpdate = 0;

  get connected() { return this.socket?.readyState === WebSocket.OPEN; }
  get lastTradeSeq() { return this.tradeSeq; }

  start() {
    if (this.running) return;
    this.running = true;
    this.connect(0);
  }

  stop() {
    this.running = false;
    this.socket?.close();
    this.socket = null;
  }

  async waitForBook(timeoutMs = 15_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const book = this.book();
      if (book) return book;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Coinbase level2 book not ready after ${timeoutMs}ms`);
  }

  book(): Book | null {
    const bids = [...this.bids.entries()].filter(([, q]) => q > 0).sort((a, b) => b[0] - a[0]);
    const asks = [...this.asks.entries()].filter(([, q]) => q > 0).sort((a, b) => a[0] - b[0]);
    if (!bids.length || !asks.length) return null;

    const bid = bids[0]![0];
    const ask = asks[0]![0];
    if (!(bid > 0) || !(ask > bid)) return null;
    const mid = (bid + ask) / 2;
    const within = (levels: Level[], bps: number) => levels
      .filter(([p]) => Math.abs(p - mid) / mid * 10_000 <= bps)
      .reduce((sum, [, q]) => sum + q, 0);
    const depthBps: Book["depthBps"] = {};
    for (const bps of [10, 25, 50]) depthBps[String(bps)] = { bid: within(bids, bps), ask: within(asks, bps) };
    const bidDepth = depthBps["50"]!.bid;
    const askDepth = depthBps["50"]!.ask;

    return {
      bid,
      ask,
      mid,
      spreadBps: ((ask - bid) / mid) * 10_000,
      imbalance: bidDepth + askDepth ? (bidDepth - askDepth) / (bidDepth + askDepth) : 0,
      levels: { bids: bids.slice(0, 5), asks: asks.slice(0, 5) },
      depthBps,
      updatedAt: this.lastBookUpdate,
    };
  }

  recentTrades(windowMs: number, now = Date.now()) {
    return this.trades.filter((t) => t.ts >= now - windowMs);
  }

  tradesAfter(seq: number): { cursor: number; trades: TradePrint[] } {
    return { cursor: this.tradeSeq, trades: this.trades.filter((t) => t.seq > seq) };
  }

  private connect(delayMs: number) {
    setTimeout(() => {
      if (!this.running) return;
      const ws = new WebSocket(config.wsUrl);
      this.socket = ws;
      ws.onopen = () => {
        this.reconnectMs = 500;
        const subscribe = (channel: string, productIds?: string[]) => ws.send(JSON.stringify({
          type: "subscribe",
          channel,
          ...(productIds ? { product_ids: productIds } : {}),
        }));
        subscribe("level2", [config.productId]);
        subscribe("market_trades", [config.productId]);
        subscribe("heartbeats", [config.productId]);
      };
      ws.onmessage = (event) => {
        try { this.handle(JSON.parse(String(event.data)) as WsMessage); }
        catch (error) { console.error("coinbase websocket message:", (error as Error).message); }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (!this.running) return;
        const next = Math.min(this.reconnectMs * 2, 10_000);
        this.connect(this.reconnectMs);
        this.reconnectMs = next;
      };
    }, delayMs);
  }

  private handle(message: WsMessage) {
    if (message.channel === "l2_data") this.handleBook(message);
    if (message.channel === "market_trades") this.handleTrades(message);
  }

  private handleBook(message: WsMessage) {
    for (const event of message.events ?? []) {
      if (event.product_id && event.product_id !== config.productId) continue;
      if (event.type === "snapshot") {
        this.bids.clear();
        this.asks.clear();
      }
      for (const update of event.updates ?? []) {
        const price = Number(update.price_level);
        const quantity = Number(update.new_quantity);
        if (!Number.isFinite(price) || !Number.isFinite(quantity)) continue;
        const side = String(update.side).toLowerCase();
        const bookSide = side === "bid" ? this.bids : side === "offer" || side === "ask" ? this.asks : null;
        if (!bookSide) continue;
        if (quantity === 0) bookSide.delete(price);
        else bookSide.set(price, quantity);
      }
      this.lastBookUpdate = Date.now();
    }
  }

  private handleTrades(message: WsMessage) {
    for (const event of message.events ?? []) {
      for (const raw of event.trades ?? []) {
        if (raw.product_id && raw.product_id !== config.productId) continue;
        const tradeId = String(raw.trade_id ?? `${raw.time}:${raw.price}:${raw.size}`);
        if (this.seenTradeIds.has(tradeId)) continue;
        this.seenTradeIds.add(tradeId);
        const price = Number(raw.price);
        const size = Number(raw.size);
        if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0) continue;
        const parsed = Date.parse(String(raw.time ?? message.timestamp ?? ""));
        const side: Side = String(raw.side).toLowerCase() === "sell" ? "sell" : "buy";
        this.trades.push({ seq: ++this.tradeSeq, tradeId, ts: Number.isFinite(parsed) ? parsed : Date.now(), side, price, size });
      }
    }
    if (this.trades.length > 20_000) this.trades.splice(0, this.trades.length - 20_000);
    if (this.seenTradeIds.size > 40_000) {
      this.seenTradeIds = new Set(this.trades.map((t) => t.tradeId));
    }
  }
}
