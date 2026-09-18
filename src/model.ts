import { experimental_evaluate } from "ai";
import { typeSafeAi } from "@ai-sdk/typesafe-ai";
import { config } from "./config";
import type { CrossMarketSnapshot } from "./signals";

export type Action = "buy" | "sell" | "hold";

export interface TradeState {
  market: string;
  venue: "coinbase";
  tick: number;
  horizonMs: number;
  decisionIntervalMs: number;
  mid: number;
  spreadBps: number;
  bookImbalance: number;
  depth: Record<string, { bid: number; ask: number }>;
  book: { bids: string[]; asks: string[] };
  returnsBps: { last1: number; last5: number; last20: number; horizon: number };
  recentMids: string;
  trades: { count: number; buyBase: number; sellBase: number; cvdBase: number; vwap: number | null; lastPrice: number | null; lastSide: "buy" | "sell" | null };
  recentTrades: string[];
  crossMarket: CrossMarketSnapshot;
  allowed: { buy: boolean; sell: boolean };
}

export interface Decision {
  action: Action;
  probabilities: Record<Action, number>;
  pUp: number;
  /** Backward-compatible alias used by the original dashboard. */
  upIn10: number;
  latencyMs: number;
  inputTokens: number;
}

export interface Model {
  readonly name: string;
  decide(state: TradeState): Promise<Decision>;
}

const QUESTIONS = {
  direction: {
    type: "choice",
    instructions: {
      question: "At the configured horizon, which action has the best expected outcome for a passive maker quote on Coinbase: buy, sell, or hold?",
      goal: "Trade the configured Coinbase spot product using a post-only style paper quote near the touch. Prefer hold when the expected short-horizon move is too small or uncertain to justify adverse-selection and fee risk.",
      timing: "A decision is made every `decisionIntervalMs`; the forecast horizon is `horizonMs`.",
      inputs: "Use Coinbase taker flow, order-book imbalance/depth, spread, short-horizon returns and recent mids. Also use `crossMarket`: Binance is a global USDT signal venue; Upbit is the Korean KRW market normalized by KRW-USDT. Positive `deltaVsCoinbaseBps` means that venue is priced above Coinbase, but the absolute level can contain persistent quote-currency basis (for example USDT vs USD). Do NOT treat a persistent positive absolute delta as inherently bullish. For direction, focus on relative changes/return differences and aggressive flow across venues. Upbit `premiumVsCoinbaseBps` is primarily a regime signal and can persist, so do not blindly mean-revert it. Ignore a venue when its snapshot is null. Treat conflicting or weak evidence as a reason to hold.",
    },
    criteria: {
      buy: "Rest a passive bid: upward short-horizon edge is strongest and large enough to justify the quote risk.",
      sell: "Rest a passive ask: downward short-horizon edge is strongest and large enough to justify the quote risk.",
      hold: "Do not quote this interval because evidence is weak, conflicting, stale, or expected edge is not sufficient.",
    },
  },
} as const;

export class JevModel implements Model {
  readonly name = config.jevModelId;
  private model = typeSafeAi.evaluationModel(config.jevModelId);

  async decide(state: TradeState): Promise<Decision> {
    const t0 = performance.now();
    const r = await experimental_evaluate({ model: this.model, state: state as any, questions: QUESTIONS, maxRetries: 0 });
    const a = r.answers.direction;
    const raw = a.probabilities ?? { [a.choice]: 1 };
    const buy = raw.buy ?? 0;
    const sell = raw.sell ?? 0;
    const hold = raw.hold ?? Math.max(0, 1 - buy - sell);
    const total = buy + sell + hold || 1;
    const probabilities = { buy: buy / total, sell: sell / total, hold: hold / total };
    return {
      action: a.choice as Action,
      probabilities,
      pUp: probabilities.buy,
      upIn10: probabilities.buy,
      latencyMs: performance.now() - t0,
      inputTokens: r.usage?.inputTokens ?? 0,
    };
  }
}

export class MockModel implements Model {
  readonly name = "mock";

  async decide(state: TradeState): Promise<Decision> {
    const t0 = performance.now();
    const flowDen = state.trades.buyBase + state.trades.sellBase;
    const flow = flowDen ? state.trades.cvdBase / flowDen : 0;

    let external = 0;
    const b = state.crossMarket.binance;
    if (b) {
      const bFlowDen = b.buyBase5s + b.sellBase5s;
      const bFlow = bFlowDen ? b.cvdBase5s / bFlowDen : 0;
      const lead1 = (b.return1sBps ?? 0) - state.returnsBps.last1;
      const lead5 = (b.return5sBps ?? 0) - state.returnsBps.last5;\n      external += lead1 / 4 + lead5 / 8 + bFlow;
    }
    const u = state.crossMarket.upbit;
    if (u) {
      const uFlowDen = u.buyBase5s + u.sellBase5s;
      const uFlow = uFlowDen ? u.cvdBase5s / uFlowDen : 0;
      const lead1 = (u.return1sBps ?? 0) - state.returnsBps.last1;
      const lead5 = (u.return5sBps ?? 0) - state.returnsBps.last5;\n      external += lead1 / 6 + lead5 / 12 + uFlow * 0.5;
    }
    external = Math.max(-3, Math.min(3, external));

    const signal = state.returnsBps.last5 / 5 + state.bookImbalance * 1.5 + flow * 2 + external + this.noise(state.tick);
    const directionalBuy = 1 / (1 + Math.exp(-signal));
    const hold = Math.min(0.45, 0.45 * Math.exp(-Math.abs(signal)));
    const probabilities = {
      buy: directionalBuy * (1 - hold),
      sell: (1 - directionalBuy) * (1 - hold),
      hold,
    };
    const action = (Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]![0]) as Action;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {
      action,
      probabilities,
      pUp: probabilities.buy,
      upIn10: probabilities.buy,
      latencyMs: performance.now() - t0,
      inputTokens: Math.round(JSON.stringify(state).length / 4),
    };
  }

  private noise(tick: number) {
    let h = tick * 2654435761 >>> 0;
    h ^= h >>> 15; h = (h * 2246822519) >>> 0; h ^= h >>> 13;
    return ((h % 1000) / 1000 - 0.5) * 0.8;
  }
}

export const createModel = (): Model => (config.model === "jev" ? new JevModel() : new MockModel());
