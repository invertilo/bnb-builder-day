import type { Address, Issuer, StockToken } from "../domain/types.js";
import { BinanceApiError } from "./errors.js";

/**
 * Endpoints públicos de Binance Wallet (sin API key). Son los que usan las Binance Wallet Skills oficiales.
 * Base: https://www.binance.com/bapi/defi — respuestas con `code: "000000"`.
 */
const BASE = "https://www.binance.com/bapi/defi";
const HEADERS = { "Accept-Encoding": "identity", "User-Agent": "binance-web3/1.1 (Skill)" };

/** `type` del listado → emisor. */
const TYPE_TO_ISSUER: Record<number, Issuer> = { 1: "ondo", 2: "xstocks", 3: "bstocks" };

export interface RwaListItem {
  chainId: string;
  contractAddress: string;
  symbol: string;
  ticker: string;
  type: number;
  assetType: number; // 1 acción, 2 pre-IPO, 3 ETF
  multiplier: string;
  d: number;
  cs?: string | null;
}

export interface RwaDynamic {
  symbol: string;
  ticker: string;
  tokenInfo: {
    price: string;
    priceChangePct24h?: string;
    sharesMultiplier?: string;
  };
  stockInfo: {
    price: string | null;
    priceHigh52w?: string | null;
    priceLow52w?: string | null;
    marketCap?: string | null;
    priceToEarnings?: string | null;
    dividendYield?: string | null;
  } | null;
  statusInfo: {
    openState: boolean;
    marketStatus: string | null;
    reasonCode: string | null;
    reasonMsg: string | null;
    nextOpenTime?: number | null;
    nextCloseTime?: number | null;
  } | null;
}

export interface RwaMarketStatus {
  marketStatus: string;
  openState: boolean;
  reasonCode: string;
  reasonMsg: string | null;
  nextOpen?: string;
  nextClose?: string;
}

export type FetchLike = typeof fetch;

export class BinancePublic {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  private async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
    const url = `${BASE}${path}${qs ? `?${qs}` : ""}`;
    const res = await this.fetchImpl(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new BinanceApiError(res.status, res.statusText, path);
    const body = (await res.json()) as { code: string; message: string | null; data: T };
    if (body.code !== "000000") throw new BinanceApiError(body.code, body.message ?? "error", path);
    return body.data;
  }

  /** Lista de acciones tokenizadas de un emisor (todas las cadenas; filtra BSC con `toStockTokens`). */
  listRwa(type: 1 | 2 | 3): Promise<RwaListItem[]> {
    return this.get("/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai", { type });
  }

  /** Precio onchain + precio de la acción en bolsa + estado de trading del activo. */
  dynamic(contractAddress: string): Promise<RwaDynamic> {
    return this.get("/v2/public/wallet-direct/buw/wallet/market/token/rwa/dynamic/ai", { chainId: 56, contractAddress });
  }

  marketStatus(): Promise<RwaMarketStatus> {
    return this.get("/v1/public/wallet-direct/buw/wallet/market/token/rwa/market/status/ai");
  }
}

export function toStockTokens(items: RwaListItem[]): StockToken[] {
  return items
    .filter((x) => x.chainId === "56" && TYPE_TO_ISSUER[x.type])
    .map((x) => ({
      ticker: x.ticker.toUpperCase(),
      symbol: x.symbol,
      name: x.ticker.toUpperCase(),
      issuer: TYPE_TO_ISSUER[x.type]!,
      address: x.contractAddress.toLowerCase() as Address,
      decimals: x.d,
    }));
}
