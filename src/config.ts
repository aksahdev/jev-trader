const env = (key: string, fallback?: string) => process.env[key] ?? fallback;

export const config = {
  venue: "coinbase" as const,
  productId: env("PRODUCT_ID", "BTC-USDC")!,
  wsUrl: env("COINBASE_WS_URL", "wss://advanced-trade-ws.coinbase.com")!,
  decisionIntervalMs: Number(env("DECISION_INTERVAL_MS", "1000")),
  horizonMs: Number(env("HORIZON_MS", "30000")),
  priceIncrement: Number(env("PRICE_INCREMENT", "0.01")),
  quoteInsideTicks: Number(env("QUOTE_INSIDE_TICKS", "1")),
  tradeSizeBase: Number(env("TRADE_SIZE_BASE", "0.0001")),
  maxPositionBase: Number(env("MAX_POSITION_BASE", "0.001")),
  bankrollUsd: Number(env("BANKROLL_USD", "100")),
  paperMakerFeeBps: Number(env("PAPER_MAKER_FEE_BPS", "0")),
  dryRun: env("DRY_RUN", "true") !== "false",
  model: env("MODEL", "mock") as "mock" | "jev",
  jevModelId: env("JEV_MODEL_ID", "jev-latest")!,
  jevUsdPerMTok: Number(env("JEV_USD_PER_MTOK", "0.042")),
  port: Number(env("PORT", "3000")),
  historySize: Number(env("HISTORY_SIZE", "1000")),
};
