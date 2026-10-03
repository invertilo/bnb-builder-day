import type { Hex } from "viem";
import { PrimeraAccion } from "./agent/service.js";
import { BinanceWeb3 } from "./binance/auth.js";
import { BinanceMarketData } from "./binance/market.js";
import { BinancePublic } from "./binance/public.js";
import { BinanceTrader } from "./binance/trader.js";
import type { Config } from "./config.js";
import { OpenAiCompatibleLlm } from "./llm/openai-compatible.js";
import type { Llm, MarketData, Trader } from "./ports.js";
import { BinanceStockQuotes, FallbackQuotes, YahooQuotes } from "./stocks/quotes.js";
import { Store } from "./store.js";
import { bscPublicClient, LocalSigner } from "./wallet/signer.js";

export const READ_ONLY_REASON =
  "El trading no está configurado: faltan BINANCE_API_KEY / BINANCE_API_SECRET o AGENT_PRIVATE_KEY en .env.";

/** Sin claves de Binance o sin wallet, el bot igual responde precios, análisis y preguntas. */
export class ReadOnlyTrader implements Trader {
  private fail(): never {
    throw new Error(READ_ONLY_REASON);
  }
  quote(): never { return this.fail(); }
  simulate(): never { return this.fail(); }
  execute(): never { return this.fail(); }
  portfolio(): never { return this.fail(); }
  explorerTxUrl(txHash: string) {
    return `https://bscscan.com/tx/${txHash}`;
  }
}

export interface App {
  agent: PrimeraAccion;
  market: MarketData;
  trader: Trader;
  llm: Llm | null;
  tradingEnabled: boolean;
  walletAddress: string | null;
}

export function buildApp(cfg: Config): App {
  const pub = new BinancePublic();
  const stockQuotes =
    cfg.STOCK_PRICE_SOURCE === "yahoo"
      ? new FallbackQuotes([new YahooQuotes(), new BinanceStockQuotes(pub)])
      : new BinanceStockQuotes(pub);
  const market = new BinanceMarketData(pub, stockQuotes, cfg.ISSUERS);

  let trader: Trader = new ReadOnlyTrader();
  let walletAddress: string | null = null;
  const tradingEnabled = Boolean(cfg.BINANCE_API_KEY && cfg.BINANCE_API_SECRET && cfg.AGENT_PRIVATE_KEY);
  if (tradingEnabled) {
    const signer = new LocalSigner(cfg.AGENT_PRIVATE_KEY as Hex, cfg.BSC_RPC_URL);
    walletAddress = signer.address;
    trader = new BinanceTrader(
      new BinanceWeb3({ apiKey: cfg.BINANCE_API_KEY!, apiSecret: cfg.BINANCE_API_SECRET! }),
      signer,
      bscPublicClient(cfg.BSC_RPC_URL),
      market,
      { slippageBps: cfg.MAX_SLIPPAGE_BPS, mevProtection: true },
    );
  }

  const llm = cfg.LLM_API_KEY
    ? new OpenAiCompatibleLlm({ baseUrl: cfg.LLM_BASE_URL, apiKey: cfg.LLM_API_KEY, model: cfg.LLM_MODEL })
    : null;

  const agent = new PrimeraAccion({
    market,
    trader,
    llm,
    store: new Store(cfg.DATA_PATH),
    policy: {
      maxTradeUsd: cfg.MAX_TRADE_USD,
      maxDailyUsd: cfg.MAX_DAILY_USD,
      maxSlippageBps: cfg.MAX_SLIPPAGE_BPS,
      maxReferenceGapBps: cfg.MAX_REFERENCE_GAP_BPS,
    },
    minTradeUsd: cfg.MIN_TRADE_USD,
  });

  return { agent, market, trader, llm, tradingEnabled, walletAddress };
}
