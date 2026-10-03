/**
 * Límites de seguridad que se chequean antes de firmar cualquier transacción.
 * Son independientes de la política de firma de la wallet del agente: si una capa falla, la otra frena.
 */

export interface TradePolicy {
  maxTradeUsd: number;
  maxDailyUsd: number;
  /** Slippage máximo aceptado, en puntos básicos (100 = 1%). */
  maxSlippageBps: number;
  /** Diferencia máxima tolerada entre precio onchain y precio de referencia, en pb. */
  maxReferenceGapBps: number;
}

export interface TradeCheck {
  usd: number;
  spentTodayUsd: number;
  slippageBps: number;
  /** null si no hay precio de referencia disponible. */
  referenceGapBps: number | null;
}

export type PolicyResult = { ok: true; warnings: string[] } | { ok: false; reason: string };

export function checkTrade(policy: TradePolicy, check: TradeCheck): PolicyResult {
  if (check.usd <= 0) return { ok: false, reason: "El monto tiene que ser mayor a 0." };
  if (check.usd > policy.maxTradeUsd) {
    return { ok: false, reason: `El máximo por operación es ${policy.maxTradeUsd} USDT.` };
  }
  if (check.spentTodayUsd + check.usd > policy.maxDailyUsd) {
    const left = Math.max(0, policy.maxDailyUsd - check.spentTodayUsd);
    return { ok: false, reason: `Llegarías al límite diario de ${policy.maxDailyUsd} USDT. Hoy te quedan ${left.toFixed(2)} USDT.` };
  }
  if (check.slippageBps > policy.maxSlippageBps) {
    return {
      ok: false,
      reason: `El slippage estimado (${(check.slippageBps / 100).toFixed(2)}%) supera tu máximo de ${(policy.maxSlippageBps / 100).toFixed(2)}%. Prueba con un monto menor.`,
    };
  }

  const warnings: string[] = [];
  if (check.referenceGapBps === null) {
    warnings.push("No hay precio de referencia disponible para comparar.");
  } else if (Math.abs(check.referenceGapBps) > policy.maxReferenceGapBps) {
    const dir = check.referenceGapBps > 0 ? "por encima" : "por debajo";
    warnings.push(
      `El precio onchain está ${(Math.abs(check.referenceGapBps) / 100).toFixed(2)}% ${dir} del precio de referencia.`,
    );
  }
  return { ok: true, warnings };
}

/** Diferencia en puntos básicos de `onchain` respecto de `reference`. */
export function gapBps(onchain: number, reference: number): number {
  return Math.round(((onchain - reference) / reference) * 10_000);
}
