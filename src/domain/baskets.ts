import type { Basket, Weights } from "./types.js";

const WEIGHT_EPSILON = 1e-6;

export class BasketError extends Error {}

/**
 * Normaliza pesos para que sumen 1. Acepta porcentajes (40, 30, 30) o fracciones (0.4, 0.3, 0.3).
 * Tickers duplicados se suman.
 */
export function normalizeWeights(raw: Record<string, number>): Weights {
  const merged: Record<string, number> = {};
  for (const [ticker, value] of Object.entries(raw)) {
    const key = ticker.trim().toUpperCase();
    if (!/^[A-Z.]{1,10}$/.test(key)) throw new BasketError(`Ticker inválido: "${ticker}"`);
    if (!Number.isFinite(value) || value <= 0) {
      throw new BasketError(`El peso de ${key} debe ser un número mayor a 0`);
    }
    merged[key] = (merged[key] ?? 0) + value;
  }

  const total = Object.values(merged).reduce((a, b) => a + b, 0);
  if (total <= 0) throw new BasketError("La canasta necesita al menos una acción");

  const weights: Weights = {};
  for (const [ticker, value] of Object.entries(merged)) weights[ticker] = value / total;
  return weights;
}

/**
 * Parsea "NVDA:40 AMD:30 TSM 30" o "NVDA 40, AMD 30, TSM 30".
 * Sin pesos ("NVDA AMD TSM") reparte en partes iguales.
 */
export function parseWeights(input: string): Weights {
  const tokens = input
    .replace(/[,;%]/g, " ")
    .replace(/:/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const raw: Record<string, number> = {};
  let withWeight = 0;
  let withoutWeight = 0;
  let i = 0;
  while (i < tokens.length) {
    const ticker = tokens[i]!.toUpperCase();
    const next = tokens[i + 1];
    if (next !== undefined && /^\d+(\.\d+)?$/.test(next)) {
      raw[ticker] = (raw[ticker] ?? 0) + Number(next);
      withWeight++;
      i += 2;
    } else {
      raw[ticker] = (raw[ticker] ?? 0) + 1;
      withoutWeight++;
      i += 1;
    }
  }
  if (withWeight > 0 && withoutWeight > 0) {
    throw new BasketError("Pon un peso a cada acción o a ninguna (ej. NVDA 50 AMD 50, o NVDA AMD)");
  }
  return normalizeWeights(raw);
}

export function assertValidBasket(basket: Basket): void {
  const sum = Object.values(basket.weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > WEIGHT_EPSILON) {
    throw new BasketError(`Los pesos de "${basket.name}" suman ${sum}, deberían sumar 1`);
  }
}

/**
 * Plantillas temáticas de ejemplo. No son recomendaciones: el usuario elige y ajusta los pesos.
 * Solo se ofrecen los tickers que existan en el catálogo onchain al momento de comprar.
 */
export const BASKET_TEMPLATES: Basket[] = [
  { id: "ia", name: "Inteligencia artificial", weights: normalizeWeights({ NVDA: 1, MSFT: 1, GOOGL: 1, META: 1 }) },
  { id: "semis", name: "Semiconductores", weights: normalizeWeights({ NVDA: 1, AMD: 1, TSM: 1, AVGO: 1 }) },
  { id: "bigtech", name: "Big Tech", weights: normalizeWeights({ AAPL: 1, MSFT: 1, AMZN: 1, GOOGL: 1, META: 1 }) },
  { id: "indice", name: "Índices", weights: normalizeWeights({ SPY: 1, QQQ: 1 }) },
];

export function describeWeights(weights: Weights): string {
  return Object.entries(weights)
    .sort(([, a], [, b]) => b - a)
    .map(([t, w]) => `${t} ${(w * 100).toFixed(0)}%`)
    .join(" · ");
}
