import type { Address, Side, StockToken } from "./domain/types.js";
import type { MarketSession } from "./domain/market-hours.js";
import type { StockQuote } from "./stocks/quotes.js";

/** Precio de un token: el onchain (lo que pagas) y el de la acción en bolsa (referencia). */
export interface PriceInfo {
  token: StockToken;
  onchainUsd: number;
  /** Valor de 1 token según la bolsa: precio de la acción × multiplicador del emisor. null sin precio de bolsa. */
  referenceUsd: number | null;
  /** Acciones que representa 1 token (dividendos reinvertidos, splits). */
  multiplier: number;
  stock: StockQuote | null;
  change24hPct: number | null;
  session: MarketSession;
  /** Si el emisor permite operar ahora (pausas por dividendos, splits, resultados). */
  tradable: { ok: boolean; reason: string | null };
  fundamentals: Fundamentals | null;
}

export interface Fundamentals {
  high52w: number | null;
  low52w: number | null;
  marketCapUsd: number | null;
  priceToEarnings: number | null;
  dividendYieldPct: number | null;
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
  /** "onchain" = simulación real de la transacción; "preflight" = chequeos previos (órdenes RFQ firmadas fuera de la cadena). */
  kind: "onchain" | "preflight";
  /** Gas estimado de la transacción principal, en BNB. */
  gasBnb: number | null;
  /** Avisos no bloqueantes, ej. "primero hay que aprobar USDT". */
  notes: string[];
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
  /** `all` en una venta: vende todo el saldo del token en vez de un monto en USD. */
  quote(token: StockToken, side: Side, usd: number, opts?: { all?: boolean }): Promise<Quote>;
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
