import { usMarketSession } from "../domain/market-hours.js";
import type { Issuer, StockToken } from "../domain/types.js";
import type { MarketData, PriceInfo } from "../ports.js";
import type { StockQuoteProvider } from "../stocks/quotes.js";
import { toStockTokens, type BinancePublic, type RwaDynamic } from "./public.js";

const CATALOG_TTL_MS = 60 * 60_000;
const PRICE_TTL_MS = 10_000;
/** Orden de preferencia cuando se listan varios emisores (más liquidez primero). */
const ISSUER_ORDER: Issuer[] = ["ondo", "bstocks", "xstocks"];
const ISSUER_TYPE: Record<Issuer, 1 | 2 | 3> = { ondo: 1, xstocks: 2, bstocks: 3 };

const REASONS: Record<string, string> = {
  MARKET_CLOSED: "la bolsa está cerrada para este activo",
  MARKET_PAUSED: "el mercado está en pausa",
  ASSET_PAUSED: "el emisor pausó este token",
  ASSET_LIMITED: "el emisor limitó este token temporalmente",
  UNSUPPORTED: "el emisor no lo soporta",
  MARKET_MAINTENANCE: "el emisor está en mantenimiento",
};
const REASON_DETAIL: Record<string, string> = {
  cash_dividend: "pago de dividendos",
  stock_split: "split de acciones",
  earnings: "publicación de resultados",
};

export class BinanceMarketData implements MarketData {
  private catalog: { at: number; tokens: StockToken[] } | null = null;
  private names = new Map<string, string>();
  private prices = new Map<string, { at: number; value: Promise<PriceInfo> }>();

  constructor(
    private readonly api: BinancePublic,
    private readonly stocks: StockQuoteProvider,
    private readonly issuers: Issuer[],
  ) {}

  async listStocks(): Promise<StockToken[]> {
    if (this.catalog && Date.now() - this.catalog.at < CATALOG_TTL_MS) return this.catalog.tokens;
    const lists = await Promise.all(this.issuers.map((i) => this.api.listRwa(ISSUER_TYPE[i])));
    const tokens = toStockTokens(lists.flat()).map((t) => ({ ...t, name: this.names.get(t.ticker) ?? t.name }));
    this.catalog = { at: Date.now(), tokens };
    return tokens;
  }

  async findStock(query: string): Promise<StockToken[]> {
    const q = query.trim().toUpperCase();
    const all = await this.listStocks();
    return all
      .filter((t) => t.ticker === q || t.symbol.toUpperCase() === q)
      .sort((a, b) => ISSUER_ORDER.indexOf(a.issuer) - ISSUER_ORDER.indexOf(b.issuer));
  }

  price(token: StockToken): Promise<PriceInfo> {
    const hit = this.prices.get(token.address);
    if (hit && Date.now() - hit.at < PRICE_TTL_MS) return hit.value;
    const value = this.fetchPrice(token);
    this.prices.set(token.address, { at: Date.now(), value });
    value.catch(() => this.prices.delete(token.address));
    return value;
  }

  private async fetchPrice(token: StockToken): Promise<PriceInfo> {
    const [dyn, stock] = await Promise.all([
      this.api.dynamic(token.address),
      this.stocks.quote(token.ticker, token.address).catch(() => null),
    ]);

    if (stock?.name) {
      this.names.set(token.ticker, stock.name);
      token.name = stock.name;
    }

    const onchainUsd = Number(dyn.tokenInfo.price);
    const multiplier = Number(dyn.tokenInfo.sharesMultiplier ?? 1) || 1;
    const change = Number(dyn.tokenInfo.priceChangePct24h);

    return {
      token,
      onchainUsd,
      referenceUsd: stock ? stock.priceUsd * multiplier : null,
      multiplier,
      stock,
      change24hPct: Number.isFinite(change) ? change : null,
      session: usMarketSession(),
      tradable: tradableFrom(dyn),
      fundamentals: fundamentalsFrom(dyn),
    };
  }
}

function tradableFrom(dyn: RwaDynamic): PriceInfo["tradable"] {
  const s = dyn.statusInfo;
  if (!s) return { ok: true, reason: null };
  if (s.openState && (s.reasonCode === null || s.reasonCode === "TRADING")) return { ok: true, reason: null };
  const base = REASONS[s.reasonCode ?? ""] ?? `estado ${s.reasonCode}`;
  const detail = s.reasonMsg ? ` (${REASON_DETAIL[s.reasonMsg] ?? s.reasonMsg})` : "";
  const next = s.nextOpenTime ? `. Vuelve a abrir ${new Date(s.nextOpenTime).toISOString().slice(0, 16).replace("T", " ")} UTC` : "";
  return { ok: false, reason: `${base}${detail}${next}` };
}

function fundamentalsFrom(dyn: RwaDynamic): PriceInfo["fundamentals"] {
  const s = dyn.stockInfo;
  if (!s) return null;
  const n = (v: string | null | undefined) => {
    const x = Number(v);
    return v !== null && v !== undefined && Number.isFinite(x) ? x : null;
  };
  return {
    high52w: n(s.priceHigh52w),
    low52w: n(s.priceLow52w),
    marketCapUsd: n(s.marketCap),
    priceToEarnings: n(s.priceToEarnings),
    dividendYieldPct: n(s.dividendYield),
  };
}
