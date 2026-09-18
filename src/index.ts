import { config } from "./config";
import { CoinbaseFeed } from "./coinbase";
import { CoinbaseTrader } from "./coinbase-trader";
import { createModel } from "./model";
import { ExternalSignals } from "./signals";
import { startServer } from "./server";

if (!config.dryRun) {
  throw new Error("Live Coinbase order execution is intentionally disabled in V0. Set DRY_RUN=true and validate the paper results first.");
}

const feed = new CoinbaseFeed();
const signals = new ExternalSignals();

feed.start();
signals.start();
await feed.waitForBook();

const model = createModel();
let trader: CoinbaseTrader;
const server = startServer(
  { model: model.name, dryRun: true, market: config.productId, venue: config.venue, startedAt: Date.now() },
  () => trader?.history ?? [],
);

trader = new CoinbaseTrader(
  feed,
  model,
  signals,
  (event, timing) => {
    server.broadcast(event);
    const d = event.decision;
    const q = event.quote;
    const probs = d ? `b${(d.probabilities.buy * 100).toFixed(0)} s${(d.probabilities.sell * 100).toFixed(0)} h${(d.probabilities.hold * 100).toFixed(0)}` : "late";
    const quote = q ? ` ${q.side.toUpperCase()} ${q.size} @ ${q.price}` : " NO QUOTE";
    const binance = event.signals.binance?.deltaVsCoinbaseBps;
    const korea = event.signals.upbit?.premiumVsCoinbaseBps;
    const cross = ` · bn ${binance == null ? "n/a" : binance.toFixed(1) + "bp"} · kr ${korea == null ? "n/a" : korea.toFixed(1) + "bp"}`;
    console.log(`#${event.tick} ${event.market} ${event.mid.toFixed(8)} ${probs}${quote} gross ${event.totals.grossPnlUsd} fees ${event.totals.feesUsd} net ${event.totals.pnlUsd}${cross}${timing ? ` · loop ${timing.loopMs}ms` : ""}`);
    if (q) server.broadcastQuote(event.tick, q);
  },
  (tick, fill) => {
    server.broadcastFill(tick, fill);
    console.log(`#${tick} PAPER FILL ${fill.side} ${fill.size} @ ${fill.price} fee $${fill.feeUsd.toFixed(6)}`);
  },
);

console.log(
  `jev-trader · Coinbase ${config.productId} · signals Binance=${config.binanceSignals ? config.binanceSymbol : "off"} Upbit=${config.upbitSignals ? config.upbitAssetCode : "off"} · model=${model.name} · ${config.decisionIntervalMs}ms decisions · PAPER ONLY · :${config.port}`,
);
trader.start();
