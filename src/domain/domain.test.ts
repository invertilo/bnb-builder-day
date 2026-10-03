import { describe, expect, it } from "vitest";
import { BasketError, normalizeWeights, parseWeights } from "./baskets.js";
import { planRebalance } from "./rebalance.js";
import { usMarketSession } from "./market-hours.js";
import { checkTrade, gapBps, type TradePolicy } from "./policy.js";

describe("parseWeights", () => {
  it("acepta porcentajes con dos puntos y comas", () => {
    expect(parseWeights("nvda:50, amd:30, tsm 20")).toEqual({ NVDA: 0.5, AMD: 0.3, TSM: 0.2 });
  });

  it("reparte en partes iguales si no hay pesos", () => {
    const w = parseWeights("AAPL MSFT");
    expect(w).toEqual({ AAPL: 0.5, MSFT: 0.5 });
  });

  it("suma tickers repetidos", () => {
    expect(parseWeights("AAPL 25 aapl 25 MSFT 50")).toEqual({ AAPL: 0.5, MSFT: 0.5 });
  });

  it("rechaza mezclar acciones con y sin peso", () => {
    expect(() => parseWeights("NVDA 40 AMD")).toThrow(BasketError);
  });

  it("rechaza pesos negativos o tickers raros", () => {
    expect(() => normalizeWeights({ AAPL: -1 })).toThrow(BasketError);
    expect(() => normalizeWeights({ "AAPL;DROP": 1 })).toThrow(BasketError);
  });
});

describe("planRebalance", () => {
  const base = { minTradeUsd: 1, driftTolerance: 0.05 };

  it("primera compra: reparte el efectivo según los pesos", () => {
    const plan = planRebalance({ ...base, weights: { NVDA: 0.5, AMD: 0.5 }, holdingsUsd: {}, cashUsd: 100 });
    expect(plan.trades).toEqual([
      { ticker: "NVDA", side: "buy", usd: 50 },
      { ticker: "AMD", side: "buy", usd: 50 },
    ]);
    expect(plan.leftoverCashUsd).toBe(0);
  });

  it("vende lo que se pasó de la tolerancia y compra lo que falta", () => {
    const plan = planRebalance({
      ...base,
      weights: { NVDA: 0.5, AMD: 0.5 },
      holdingsUsd: { NVDA: 80, AMD: 20 },
      cashUsd: 0,
    });
    expect(plan.trades).toEqual([
      { ticker: "NVDA", side: "sell", usd: 30 },
      { ticker: "AMD", side: "buy", usd: 30 },
    ]);
  });

  it("no vende si el desvío está dentro de la tolerancia", () => {
    const plan = planRebalance({
      ...base,
      weights: { NVDA: 0.5, AMD: 0.5 },
      holdingsUsd: { NVDA: 52, AMD: 48 },
      cashUsd: 0,
    });
    expect(plan.trades.filter((t) => t.side === "sell")).toEqual([]);
  });

  it("nunca compra más que el efectivo disponible", () => {
    const plan = planRebalance({
      ...base,
      driftTolerance: 1, // sin ventas
      weights: { A: 1 / 3, B: 1 / 3, C: 1 / 3 },
      holdingsUsd: { A: 90 },
      cashUsd: 10,
    });
    const bought = plan.trades.reduce((s, t) => s + (t.side === "buy" ? t.usd : 0), 0);
    expect(bought).toBeLessThanOrEqual(10);
    expect(plan.leftoverCashUsd).toBeGreaterThanOrEqual(0);
  });

  it("omite trades más chicos que el mínimo", () => {
    const plan = planRebalance({ ...base, minTradeUsd: 5, weights: { A: 0.98, B: 0.02 }, holdingsUsd: {}, cashUsd: 100 });
    expect(plan.trades).toEqual([{ ticker: "A", side: "buy", usd: 98 }]);
    expect(plan.leftoverCashUsd).toBe(2);
  });
});

describe("usMarketSession", () => {
  it("abierto un martes a media mañana en Nueva York", () => {
    expect(usMarketSession(new Date("2026-10-06T15:00:00Z"))).toBe("open"); // 11:00 ET
  });
  it("cerrado el fin de semana", () => {
    expect(usMarketSession(new Date("2026-10-03T16:00:00Z"))).toBe("closed-weekend"); // sábado
  });
  it("cerrado en feriado", () => {
    expect(usMarketSession(new Date("2026-11-26T16:00:00Z"))).toBe("closed-holiday"); // Thanksgiving
  });
  it("cerrado fuera de hora", () => {
    expect(usMarketSession(new Date("2026-10-06T21:30:00Z"))).toBe("closed-overnight"); // 17:30 ET
  });
  it("cierre anticipado el día después de Thanksgiving", () => {
    expect(usMarketSession(new Date("2026-11-27T18:30:00Z"))).toBe("closed-overnight"); // 13:30 ET
  });
});

describe("checkTrade", () => {
  const policy: TradePolicy = { maxTradeUsd: 50, maxDailyUsd: 100, maxSlippageBps: 100, maxReferenceGapBps: 200 };

  it("bloquea montos sobre el máximo por operación", () => {
    expect(checkTrade(policy, { usd: 60, spentTodayUsd: 0, slippageBps: 10, referenceGapBps: 0 }).ok).toBe(false);
  });
  it("bloquea si se pasa del límite diario", () => {
    expect(checkTrade(policy, { usd: 30, spentTodayUsd: 80, slippageBps: 10, referenceGapBps: 0 }).ok).toBe(false);
  });
  it("bloquea slippage alto", () => {
    expect(checkTrade(policy, { usd: 10, spentTodayUsd: 0, slippageBps: 150, referenceGapBps: 0 }).ok).toBe(false);
  });
  it("deja pasar pero avisa si el precio se separa de la referencia", () => {
    const r = checkTrade(policy, { usd: 10, spentTodayUsd: 0, slippageBps: 10, referenceGapBps: gapBps(103, 100) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings[0]).toContain("3.00% por encima");
  });
});
