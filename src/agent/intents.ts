import { z } from "zod/v4";
import { parseWeights } from "../domain/baskets.js";

export const IntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("price"), ticker: z.string() }),
  z.object({ kind: z.literal("analyze"), ticker: z.string() }),
  z.object({ kind: z.literal("buy"), ticker: z.string(), usd: z.number().positive() }),
  z.object({ kind: z.literal("sell"), ticker: z.string(), usd: z.union([z.number().positive(), z.literal("all")]) }),
  z.object({ kind: z.literal("portfolio") }),
  z.object({ kind: z.literal("history") }),
  z.object({ kind: z.literal("basket_list") }),
  z.object({ kind: z.literal("basket_create"), name: z.string(), weights: z.record(z.string(), z.number().positive()) }),
  z.object({ kind: z.literal("basket_buy"), basket: z.string(), usd: z.number().positive() }),
  z.object({ kind: z.literal("basket_rebalance"), basket: z.string() }),
  z.object({ kind: z.literal("dca_create"), basket: z.string(), usd: z.number().positive(), everyDays: z.number().int().min(1).max(90) }),
  z.object({ kind: z.literal("explain"), question: z.string() }),
  z.object({ kind: z.literal("help") }),
  z.object({ kind: z.literal("unknown") }),
]);

export type Intent = z.infer<typeof IntentSchema>;

/** Nombres comunes en español → ticker. Lo que no está acá se pasa tal cual y se busca en el catálogo. */
export const TICKER_ALIASES: Record<string, string> = {
  apple: "AAPL",
  tesla: "TSLA",
  nvidia: "NVDA",
  microsoft: "MSFT",
  google: "GOOGL",
  alphabet: "GOOGL",
  amazon: "AMZN",
  meta: "META",
  facebook: "META",
  netflix: "NFLX",
  coinbase: "COIN",
  microstrategy: "MSTR",
  strategy: "MSTR",
  amd: "AMD",
  intel: "INTC",
  broadcom: "AVGO",
  tsmc: "TSM",
  "s&p": "SPY",
  "s&p500": "SPY",
  sp500: "SPY",
  nasdaq: "QQQ",
  "mercado libre": "MELI",
  mercadolibre: "MELI",
};

export function resolveTicker(word: string): string {
  const w = word.trim().toLowerCase().replace(/^(el|la|los|las) /, "");
  return TICKER_ALIASES[w] ?? w.toUpperCase();
}

const AMOUNT = String.raw`(\d+(?:[.,]\d+)?)`;
const NAME = String.raw`([a-záéíóúñ0-9&.\s]+?)`;
const num = (s: string) => Number(s.replace(",", "."));

/**
 * Parser determinístico para frases frecuentes. Es gratis y no falla por red;
 * lo que no entiende se lo pasamos al LLM.
 */
export function parseIntentRules(input: string): Intent | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, " ");

  if (/^(ayuda|help|\?|\/start|\/ayuda|hola)$/.test(text)) return { kind: "help" };
  if (/^(\/portafolio|portafolio|portfolio|mi portafolio|saldo|mis acciones)$/.test(text)) return { kind: "portfolio" };
  if (/^(\/historial|historial|mis compras)$/.test(text)) return { kind: "history" };
  if (/^(\/canastas|canastas|mis canastas)$/.test(text)) return { kind: "basket_list" };

  let m = text.match(new RegExp(String.raw`^(?:/precio|precio|cotiza|cuánto (?:está|vale|cuesta)) (?:de |a )?${NAME}\??$`));
  if (m) return { kind: "price", ticker: resolveTicker(m[1]!) };

  m = text.match(new RegExp(String.raw`^(?:/analizar|analiza|analizar|análisis de|analisis de|info de|información de|informacion de) ${NAME}\??$`));
  if (m) return { kind: "analyze", ticker: resolveTicker(m[1]!) };

  // "canasta chips NVDA 40 AMD 30 TSM 30" / "crea la canasta chips: NVDA AMD"
  m = text.match(/^(?:\/canasta|canasta|crea(?:r)? (?:la |una )?canasta) ([a-z0-9áéíóúñ-]+):? (.+)$/);
  if (m) {
    try {
      return { kind: "basket_create", name: m[1]!, weights: parseWeights(m[2]!) };
    } catch {
      return null;
    }
  }

  // "compra 20 de mi canasta chips cada 7 días" / "invierte 10 en apple cada 30 dias"
  m = text.match(new RegExp(String.raw`^(?:compra|comprar|invierte|invertir) ${AMOUNT} ?(?:usdt|usd|dólares|dolares|\$)? (?:de |en )?(?:mi |la )?(?:canasta )?${NAME} cada ${AMOUNT} d[ií]as?$`));
  if (m) return { kind: "dca_create", basket: m[2]!.trim(), usd: num(m[1]!), everyDays: Math.round(num(m[3]!)) };

  m = text.match(new RegExp(String.raw`^(?:compra|comprar|invierte|invertir) ${AMOUNT} ?(?:usdt|usd|dólares|dolares|\$)? (?:de |en )?(?:mi |la )?canasta ${NAME}$`));
  if (m) return { kind: "basket_buy", basket: m[2]!.trim(), usd: num(m[1]!) };

  m = text.match(new RegExp(String.raw`^(?:/rebalancear|rebalancea|rebalancear) (?:mi |la )?(?:canasta )?${NAME}$`));
  if (m) return { kind: "basket_rebalance", basket: m[1]!.trim() };

  m = text.match(new RegExp(String.raw`^(?:/comprar|compra|comprar|quiero comprar|invierte|invertir) ${AMOUNT} ?(?:usdt|usd|dólares|dolares|\$)? (?:de |en )?${NAME}$`));
  if (m) return { kind: "buy", ticker: resolveTicker(m[2]!), usd: num(m[1]!) };

  m = text.match(new RegExp(String.raw`^(?:/vender|vende|vender) (?:todo|todas?) (?:mis |mi )?(?:acciones )?(?:de |en )?${NAME}$`));
  if (m) return { kind: "sell", ticker: resolveTicker(m[1]!), usd: "all" };

  m = text.match(new RegExp(String.raw`^(?:/vender|vende|vender) ${AMOUNT} ?(?:usdt|usd|dólares|dolares|\$)? (?:de |en )?${NAME}$`));
  if (m) return { kind: "sell", ticker: resolveTicker(m[2]!), usd: num(m[1]!) };

  return null;
}
