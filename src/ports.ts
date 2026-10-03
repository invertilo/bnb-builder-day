import type { Address, Side, StockToken } from "./domain/types.js";
import type { MarketSession } from "./domain/market-hours.js";

/** Precio de un token: el onchain (lo que pagas) y el de la acción subyacente (referencia). */
export interface PriceInfo {
  token: StockToken;
  onchainUsd: number;
  referenceUsd: number | null;
  session: MarketSession;
}

export interface Quote {
  token: StockToken;
  side: Side;
  /** USDT que entran (compra) o que se esperan recibir (venta). */
  usd: number;
  /** Unidades del token, en unidades humanas (no wei). */
  tokenAmount: number;
  /** Mínimo garantizado después del slippage, en unidades humanas del activo de salida. */
  minOut: number;
  slippageBps: number;
  priceImpactBps: number | null;
  route: string;
  /** Datos opacos que el proveedor necesita para ejecutar esta misma cotización. */
  raw: unknown;
}

export interface Simulation {
  ok: boolean;
  gasUsd: number | null;
  error?: string;
}

export interface Position {
  token: StockToken;
  units: number;
  valueUsd: number;
}

export interface Portfolio {
  address: Address;
  stableUsd: number;
  bnb: number;
  positions: Position[];
}

/** Datos de mercado de acciones tokenizadas. */
export interface MarketData {
  listStocks(): Promise<StockToken[]>;
  /** Busca por ticker ("AAPL") o símbolo ("AAPLx"). Si hay varios emisores, devuelve todos. */
  findStock(query: string): Promise<StockToken[]>;
  price(token: StockToken): Promise<PriceInfo>;
}

/** Ejecución onchain desde la wallet del agente. */
export interface Trader {
  quote(token: StockToken, side: Side, usd: number): Promise<Quote>;
  simulate(quote: Quote): Promise<Simulation>;
  execute(quote: Quote): Promise<{ txHash: string }>;
  portfolio(): Promise<Portfolio>;
  explorerTxUrl(txHash: string): string;
}

/** Modelo de lenguaje para entender mensajes libres y responder preguntas educativas. */
export interface Llm {
  /** Devuelve JSON que cumple el esquema descrito en `instructions`. */
  json(instructions: string, userMessage: string): Promise<unknown>;
  text(instructions: string, userMessage: string): Promise<string>;
}
