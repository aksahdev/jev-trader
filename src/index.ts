import { config } from "./config";
import { CoinbaseFeed } from "./coinbase";
import { CoinbaseTrader } from "./coinbase-trader";
import { createModel } from "./model";
import { startServer } from "./server";

if (!config.dryRun) {
  throw new Error("Live Coinbase order execution is intentionally disabled in V0. Set DRY_RUN=true and validate the paper results first.");
}

const feed = new CoinbaseFeed();
feed.start();
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
  (event, timing) => {
    server.broadcast(event);
    const d = event.decision;
    const q = event.quote;
    const probs = d ? `b${(d.probabilities.buy * 100).toFixed(0)} s${(d.probabilities.sell * 100).toFixed(0)} h${(d.probabilities.hold * 100).toFixed(0)}` : "late";
    const quote = q ? ` ${q.side.toUpperCase()} ${q.size} @ ${q.price}` : " NO QUOTE";
    console.log(`#${event.tick} ${event.market} ${event.mid.toFixed(2)} ${probs}${quote} pnl $${event.totals.pnlUsd}${timing ? ` · loop ${timing.loopMs}ms` : ""}`);
    if (q) server.broadcastQuote(event.tick, q);
  },
  (tick, fill) => {
    server.broadcastFill(tick, fill);
    console.log(`#${tick} PAPER FILL ${fill.side} ${fill.size} @ ${fill.price} fee $${fill.feeUsd.toFixed(6)}`);
  },
);

console.log(`jev-trader · Coinbase ${config.productId} · model=${model.name} · ${config.decisionIntervalMs}ms decisions · ${config.horizonMs}ms horizon · PAPER ONLY · :${config.port}`);
trader.start();
