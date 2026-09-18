const env = (key: string, fallback?: string) => process.env[key] ?? fallback;
const bool = (key: string, fallback = true) => env(key, String(fallback)) !== "false";
const requestedProductId = env("PRODUCT_ID", "BTC-USD")!;
const productId = env("COINBASE_PRODUCT_ID", requestedProductId.replace(/-USDC$/i, "-USD"))!;
const baseAsset = env("BASE_ASSET", requestedProductId.split("-")[0]!)!;

export const config = {
  venue: "coinbase" as const,
  requestedProductId,
  productId,
  baseAsset,
  wsUrl: env("COINBASE_WS_URL", "wss://advanced-trade-ws.coinbase.com")!,

  // Keyless signal venues. Coinbase remains the paper execution venue.
  binanceSignals: bool("BINANCE_SIGNALS", true),
  binanceWsBase: env("BINANCE_WS_BASE", "wss://stream.binance.com:9443")!,
  binanceSymbol: env("BINANCE_SYMBOL", `${baseAsset}USDT`)!,
  upbitSignals: bool("UPBIT_SIGNALS", true),
  upbitWsUrl: env("UPBIT_WS_URL", "wss://api.upbit.com/websocket/v1")!,
  upbitAssetCode: env("UPBIT_ASSET_CODE", `KRW-${baseAsset}`)!,
  upbitFxCode: env("UPBIT_FX_CODE", "KRW-USDT")!,
  signalMaxAgeMs: Number(env("SIGNAL_MAX_AGE_MS", "5000")),

  decisionIntervalMs: Number(env("DECISION_INTERVAL_MS", "1000")),
  horizonMs: Number(env("HORIZON_MS", "30000")),
  priceIncrement: Number(env("PRICE_INCREMENT", "0.01")),
  quoteInsideTicks: Number(env("QUOTE_INSIDE_TICKS", "1")),
  tradeSizeBase: Number(env("TRADE_SIZE_BASE", "0.0001")),
  maxPositionBase: Number(env("MAX_POSITION_BASE", "0.001")),
  bankrollUsd: Number(env("BANKROLL_USD", "100")),
  paperMakerFeeBps: Number(env("PAPER_MAKER_FEE_BPS", "40")),
  paperQueueFraction: Number(env("PAPER_QUEUE_FRACTION", "1")),
  dryRun: env("DRY_RUN", "true") !== "false",
  model: env("MODEL", "mock") as "mock" | "jev",
  jevModelId: env("JEV_MODEL_ID", "jev-latest")!,
  jevUsdPerMTok: Number(env("JEV_USD_PER_MTOK", "0.042")),
  port: Number(env("PORT", "3000")),
  historySize: Number(env("HISTORY_SIZE", "1000")),
};
