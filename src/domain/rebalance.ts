import type { PlannedTrade, Weights } from "./types.js";

export interface RebalanceInput {
  weights: Weights;
  /** Valor actual en USD por ticker. Tickers fuera de la canasta se ignoran (no se venden). */
  holdingsUsd: Record<string, number>;
  /** Stablecoin disponible para invertir. */
  cashUsd: number;
  /** Trades más chicos que esto se omiten (el gas y el slippage se los comen). */
  minTradeUsd: number;
  /** Desvío máximo tolerado por posición antes de vender, en puntos de peso (0.05 = 5 pp). */
  driftTolerance: number;
}

export interface RebalancePlan {
  totalUsd: number;
  targetUsd: Record<string, number>;
  /** Ventas primero, después compras: las compras usan lo que liberan las ventas. */
  trades: PlannedTrade[];
  /** Stablecoin que queda sin invertir después del plan. */
  leftoverCashUsd: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function planRebalance(input: RebalanceInput): RebalancePlan {
  const { weights, holdingsUsd, cashUsd, minTradeUsd, driftTolerance } = input;
  const tickers = Object.keys(weights);

  const investedUsd = tickers.reduce((sum, t) => sum + (holdingsUsd[t] ?? 0), 0);
  const totalUsd = investedUsd + cashUsd;

  const targetUsd: Record<string, number> = {};
  for (const t of tickers) targetUsd[t] = totalUsd * weights[t]!;

  // Ventas: solo posiciones que se pasaron del peso objetivo más la tolerancia.
  const sells: PlannedTrade[] = [];
  for (const t of tickers) {
    const current = holdingsUsd[t] ?? 0;
    const currentWeight = totalUsd > 0 ? current / totalUsd : 0;
    if (currentWeight - weights[t]! <= driftTolerance) continue;
    const usd = round2(current - targetUsd[t]!);
    if (usd >= minTradeUsd) sells.push({ ticker: t, side: "sell", usd });
  }

  let available = cashUsd + sells.reduce((sum, s) => sum + s.usd, 0);

  // Compras: llenar los déficits, el más grande primero, sin pasarse del efectivo disponible.
  const deficits = tickers
    .map((t) => ({ ticker: t, usd: targetUsd[t]! - (holdingsUsd[t] ?? 0) }))
    .filter((d) => d.usd > 0)
    .sort((a, b) => b.usd - a.usd);

  const totalDeficit = deficits.reduce((sum, d) => sum + d.usd, 0);
  // Si no alcanza para todo, se reparte proporcional al déficit.
  const scale = totalDeficit > available ? available / totalDeficit : 1;

  const buys: PlannedTrade[] = [];
  for (const d of deficits) {
    const usd = Math.floor(d.usd * scale * 100) / 100;
    if (usd < minTradeUsd || usd > available) continue;
    buys.push({ ticker: d.ticker, side: "buy", usd });
    available -= usd;
  }

  return {
    totalUsd: round2(totalUsd),
    targetUsd: Object.fromEntries(Object.entries(targetUsd).map(([t, v]) => [t, round2(v)])),
    trades: [...sells, ...buys],
    leftoverCashUsd: round2(available),
  };
}
