import { gapBps } from "../domain/policy.js";
import type { MarketData } from "../ports.js";

export interface QuoteCard {
  ticker: string;
  name: string;
  stock: {
    price: number;
    session: string;
    /** Variación del día (sesión regular vs cierre anterior), en %. */
    dayChangePct: number | null;
    source: string;
    at: string | null;
  } | null;
  tokens: Array<{ symbol: string; issuer: string; price: number; gapPct: number | null; tradable: boolean }>;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Datos para las cards de precios en vivo de la landing (sin LLM). */
export async function buildQuoteCards(market: MarketData, tickers: string[]): Promise<QuoteCard[]> {
  const cards = await Promise.all(
    tickers.map(async (ticker): Promise<QuoteCard | null> => {
      const tokens = await market.findStock(ticker).catch(() => []);
      if (!tokens.length) return null;
      const prices = (await Promise.allSettled(tokens.map((t) => market.price(t)))).flatMap((r) =>
        r.status === "fulfilled" ? [r.value] : [],
      );
      if (!prices.length) return null;

      const q = prices.find((p) => p.stock)?.stock ?? null;
      let dayChangePct: number | null = null;
      if (q?.previousCloseUsd) {
        const base = q.session === "regular" ? q.priceUsd : q.regularPriceUsd;
        if (base) dayChangePct = round((base / q.previousCloseUsd - 1) * 100);
      }

      return {
        ticker,
        name: prices[0]!.token.name,
        stock: q
          ? { price: round(q.priceUsd), session: q.session, dayChangePct, source: q.source, at: q.at?.toISOString() ?? null }
          : null,
        tokens: prices.map((p) => ({
          symbol: p.token.symbol,
          issuer: p.token.issuer,
          price: round(p.onchainUsd),
          gapPct: p.referenceUsd ? gapBps(p.onchainUsd, p.referenceUsd) / 100 : null,
          tradable: p.tradable.ok,
        })),
      };
    }),
  );
  return cards.filter((c): c is QuoteCard => c !== null);
}

/** Tickers permitidos en /api/quotes?t=… (evita que se use para consultar cualquier cosa). */
export function parseTickers(param: string | null, fallback: string[], max = 4): string[] {
  if (!param) return fallback;
  const list = param
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter((t) => /^[A-Z.]{1,6}$/.test(t));
  return [...new Set(list)].slice(0, max);
}
