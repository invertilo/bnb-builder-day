import type { BinancePublic, FetchLike } from "../binance/public.js";

/** Precio de la acción en la bolsa de EE.UU. (por acción, no por token). */
export interface StockQuote {
  ticker: string;
  name: string | null;
  priceUsd: number;
  /** Momento del último precio. null si la fuente no lo informa. */
  at: Date | null;
  /** Sesión a la que corresponde el precio. */
  session: "pre" | "regular" | "post" | "closed" | "unknown";
  /** Último precio de la sesión regular (el cierre, si la sesión ya terminó). */
  regularPriceUsd: number | null;
  /** Cierre del día hábil anterior a la última sesión regular. */
  previousCloseUsd: number | null;
  source: "Yahoo Finance" | "Binance";
}

export interface StockQuoteProvider {
  quote(ticker: string, tokenAddress?: string): Promise<StockQuote | null>;
}

interface YahooMeta {
  regularMarketPrice?: number;
  regularMarketTime?: number;
  previousClose?: number;
  chartPreviousClose?: number;
  longName?: string;
  shortName?: string;
  currentTradingPeriod?: Record<"pre" | "regular" | "post", { start: number; end: number }>;
}

interface YahooChart {
  chart: {
    result: Array<{
      meta: YahooMeta;
      timestamp?: number[];
      indicators: { quote: Array<{ close: Array<number | null> }> };
    }> | null;
    error: { description: string } | null;
  };
}

/**
 * Precio en tiempo real desde el endpoint de gráficos de Yahoo Finance (sin API key).
 * Con `includePrePost` toma también el pre y post mercado. Es una API no oficial:
 * para producción conviene un feed con licencia.
 */
export class YahooQuotes implements StockQuoteProvider {
  private cache = new Map<string, { at: number; value: StockQuote | null }>();

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly ttlMs = 15_000,
  ) {}

  async quote(ticker: string): Promise<StockQuote | null> {
    const hit = this.cache.get(ticker);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d&includePrePost=true`;
    const res = await this.fetchImpl(url, {
      headers: { "User-Agent": "Mozilla/5.0 (PrimeraAccion bot)" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`Yahoo Finance respondió ${res.status}`);
    const value = parseYahooChart(ticker, (await res.json()) as YahooChart);
    this.cache.set(ticker, { at: Date.now(), value });
    return value;
  }
}

export function parseYahooChart(ticker: string, body: YahooChart): StockQuote | null {
  const result = body.chart.result?.[0];
  if (!result) return null;
  const { meta } = result;

  // Último precio de minuto no nulo (incluye pre/post mercado); si no hay, el de la sesión regular.
  let price = meta.regularMarketPrice ?? null;
  let at = meta.regularMarketTime ?? null;
  const ts = result.timestamp ?? [];
  const closes = result.indicators.quote[0]?.close ?? [];
  for (let i = ts.length - 1; i >= 0; i--) {
    const c = closes[i];
    if (c !== null && c !== undefined && (at === null || ts[i]! >= at)) {
      price = c;
      at = ts[i]!;
      break;
    }
  }
  if (price === null) return null;

  return {
    ticker,
    name: meta.longName ?? meta.shortName ?? null,
    priceUsd: price,
    at: at !== null ? new Date(at * 1000) : null,
    session: at !== null ? sessionOf(at, meta.currentTradingPeriod) : "unknown",
    regularPriceUsd: meta.regularMarketPrice ?? null,
    previousCloseUsd: meta.previousClose ?? meta.chartPreviousClose ?? null,
    source: "Yahoo Finance",
  };
}

function sessionOf(at: number, periods: YahooMeta["currentTradingPeriod"]): StockQuote["session"] {
  if (!periods) return "unknown";
  if (at >= periods.regular.start && at < periods.regular.end) return "regular";
  if (at >= periods.pre.start && at < periods.pre.end) return "pre";
  if (at >= periods.post.start && at <= periods.post.end) return "post";
  return "closed";
}

/** Precio de la acción que publica Binance junto a cada token (sin hora exacta). */
export class BinanceStockQuotes implements StockQuoteProvider {
  constructor(private readonly api: BinancePublic) {}

  async quote(ticker: string, tokenAddress?: string): Promise<StockQuote | null> {
    if (!tokenAddress) return null;
    const d = await this.api.dynamic(tokenAddress);
    const price = Number(d.stockInfo?.price);
    if (!Number.isFinite(price) || price <= 0) return null;
    return { ticker, name: null, priceUsd: price, at: null, session: "unknown", regularPriceUsd: null, previousCloseUsd: null, source: "Binance" };
  }
}

/** Usa la primera fuente que responda. */
export class FallbackQuotes implements StockQuoteProvider {
  constructor(private readonly providers: StockQuoteProvider[]) {}

  async quote(ticker: string, tokenAddress?: string): Promise<StockQuote | null> {
    for (const p of this.providers) {
      try {
        const q = await p.quote(ticker, tokenAddress);
        if (q) return q;
      } catch (err) {
        console.warn(`[precios] ${p.constructor.name} falló para ${ticker}:`, (err as Error).message);
      }
    }
    return null;
  }
}
