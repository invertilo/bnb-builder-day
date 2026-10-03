export type Issuer = "bstocks" | "ondo" | "xstocks";

export type Address = `0x${string}`;

/** Un token de acción tokenizada en BSC. El mismo ticker puede existir en varios emisores. */
export interface StockToken {
  /** Ticker de la acción subyacente, ej. "AAPL". */
  ticker: string;
  /** Símbolo del token onchain, ej. "AAPLx". */
  symbol: string;
  name: string;
  issuer: Issuer;
  address: Address;
  decimals: number;
}

/** Pesos objetivo por ticker. Suman 1. */
export type Weights = Record<string, number>;

export interface Basket {
  id: string;
  name: string;
  weights: Weights;
}

export type Side = "buy" | "sell";

export interface PlannedTrade {
  ticker: string;
  side: Side;
  usd: number;
}
