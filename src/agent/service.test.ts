import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Side, StockToken } from "../domain/types.js";
import type { MarketData, Portfolio, PriceInfo, Quote, Trader } from "../ports.js";
import { Store } from "../store.js";
import { PrimeraAccion } from "./service.js";

const TOKENS: StockToken[] = [
  { ticker: "AAPL", symbol: "AAPLx", name: "Apple", issuer: "xstocks", address: "0x0000000000000000000000000000000000000001", decimals: 18 },
  { ticker: "AAPL", symbol: "bAAPL", name: "Apple", issuer: "bstocks", address: "0x0000000000000000000000000000000000000002", decimals: 18 },
  { ticker: "NVDA", symbol: "NVDAon", name: "NVIDIA", issuer: "ondo", address: "0x0000000000000000000000000000000000000003", decimals: 18 },
];
const PRICES: Record<string, number> = { AAPLx: 200, bAAPL: 198, NVDAon: 100 };
const REF: Record<string, number> = { AAPL: 199, NVDA: 100 };

class FakeMarket implements MarketData {
  async listStocks() { return TOKENS; }
  async findStock(q: string) { return TOKENS.filter((t) => t.ticker === q.toUpperCase() || t.symbol === q); }
  paused = new Set<string>();
  async price(token: StockToken): Promise<PriceInfo> {
    const ref = REF[token.ticker] ?? null;
    return {
      token,
      onchainUsd: PRICES[token.symbol]!,
      referenceUsd: ref,
      multiplier: 1,
      stock: ref
        ? { ticker: token.ticker, name: token.name, priceUsd: ref, at: null, session: "regular", regularPriceUsd: ref, previousCloseUsd: ref, source: "Yahoo Finance" }
        : null,
      change24hPct: 0,
      session: "open",
      tradable: this.paused.has(token.symbol) ? { ok: false, reason: "el emisor pausó este token (pago de dividendos)" } : { ok: true, reason: null },
      fundamentals: null,
    };
  }
}

class FakeTrader implements Trader {
  executed: Quote[] = [];
  holdings = new Map<string, number>();
  async quote(token: StockToken, side: Side, usd: number, opts: { all?: boolean } = {}): Promise<Quote> {
    const px = PRICES[token.symbol]!;
    const units = side === "sell" && opts.all ? this.holdings.get(token.symbol) ?? 0 : usd / px;
    return { token, side, usd: units * px, tokenAmount: units, minOut: units * 0.99, slippageBps: 50, priceImpactBps: 10, route: "fake", raw: null };
  }
  async simulate() { return { ok: true, kind: "onchain" as const, gasBnb: 0.0002, notes: [] }; }
  async execute(q: Quote) {
    this.executed.push(q);
    const prev = this.holdings.get(q.token.symbol) ?? 0;
    this.holdings.set(q.token.symbol, q.side === "buy" ? prev + q.tokenAmount : Math.max(0, prev - q.tokenAmount));
    return { txHash: `0xhash${this.executed.length}` };
  }
  async portfolio(): Promise<Portfolio> {
    return {
      address: "0x00000000000000000000000000000000000000aa",
      stableUsd: 1000,
      bnb: 0.1,
      positions: TOKENS.filter((t) => (this.holdings.get(t.symbol) ?? 0) > 0).map((t) => {
        const units = this.holdings.get(t.symbol)!;
        return { token: t, units, valueUsd: units * PRICES[t.symbol]! };
      }),
    };
  }
  explorerTxUrl(h: string) { return `https://bscscan.com/tx/${h}`; }
}

let trader: FakeTrader;
let market: FakeMarket;
let agent: PrimeraAccion;
const OWNER = 42;
const STRANGER = 7;
// Martes 11:00 en Nueva York: bolsa abierta.
const now = () => new Date("2026-10-06T15:00:00Z");

beforeEach(async () => {
  trader = new FakeTrader();
  const dir = await mkdtemp(join(tmpdir(), "pa-"));
  market = new FakeMarket();
  agent = new PrimeraAccion({
    market,
    trader,
    llm: null,
    store: new Store(join(dir, "state.json")),
    policy: { maxTradeUsd: 100, maxDailyUsd: 150, maxSlippageBps: 100, maxReferenceGapBps: 200 },
    minTradeUsd: 1,
    now,
  });
});

describe("PrimeraAccion", () => {
  it("compra: cotiza, pide confirmación y recién ahí ejecuta", async () => {
    const reply = await agent.handle(OWNER, "compra 20 de apple", true);
    expect(reply.confirmId).toBeDefined();
    expect(trader.executed).toHaveLength(0);

    const done = await agent.confirm(OWNER, reply.confirmId!);
    expect(done.text).toContain("Compraste");
    expect(trader.executed).toHaveLength(1);
  });

  it("elige el emisor con mejor precio frente a la referencia", async () => {
    const reply = await agent.handle(OWNER, "compra 20 de apple", true);
    expect(reply.text).toContain("bAAPL"); // 198 < 200
  });

  it("un desconocido puede ver precios pero no comprar ni ver el portafolio", async () => {
    expect((await agent.handle(STRANGER, "precio de apple", false)).text).toContain("Apple");
    expect((await agent.handle(STRANGER, "compra 20 de apple", false)).text).toContain("🔒");
    expect((await agent.handle(STRANGER, "portafolio", false)).text).toContain("🔒");
  });

  it("otro usuario no puede confirmar una operación ajena", async () => {
    const reply = await agent.handle(OWNER, "compra 20 de apple", true);
    await agent.confirm(STRANGER, reply.confirmId!);
    expect(trader.executed).toHaveLength(0);
  });

  it("respeta el límite por operación y el diario", async () => {
    expect((await agent.handle(OWNER, "compra 101 de apple", true)).text).toContain("⛔");

    const a = await agent.handle(OWNER, "compra 100 de apple", true);
    await agent.confirm(OWNER, a.confirmId!);
    const b = await agent.handle(OWNER, "compra 60 de nvidia", true);
    expect(b.text).toContain("límite diario");
  });

  it("canasta: crea, compra repartido y confirma todas las órdenes", async () => {
    const created = await agent.handle(OWNER, "canasta mix apple 50 nvidia 50", true);
    expect(created.text).toContain("guardada");

    const reply = await agent.handle(OWNER, "invierte 40 en mix", true);
    expect(reply.confirmId).toBeDefined();
    await agent.confirm(OWNER, reply.confirmId!);
    expect(trader.executed.map((q) => [q.token.ticker, q.usd])).toEqual([
      ["AAPL", 20],
      ["NVDA", 20],
    ]);
  });

  it("rechaza confirmar una cotización vencida", async () => {
    const reply = await agent.handle(OWNER, "compra 10 de nvidia", true);
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try {
      expect((await agent.confirm(OWNER, reply.confirmId!)).text).toContain("venció");
    } finally {
      Date.now = realNow;
    }
    expect(trader.executed).toHaveLength(0);
  });

  it("vender todo usa la posición que realmente tienes", async () => {
    const buy = await agent.handle(OWNER, "compra 30 de nvidia", true);
    await agent.confirm(OWNER, buy.confirmId!);
    const sell = await agent.handle(OWNER, "vende todo mi nvidia", true);
    expect(sell.text).toContain("Vender todo tu NVDA");
    await agent.confirm(OWNER, sell.confirmId!);
    expect(trader.holdings.get("NVDAon")).toBe(0);
  });

  it("salta el emisor pausado y usa el otro", async () => {
    market.paused.add("bAAPL");
    const reply = await agent.handle(OWNER, "compra 20 de apple", true);
    expect(reply.text).toContain("AAPLx");
  });

  it("si todos los emisores están pausados, explica el motivo", async () => {
    market.paused.add("NVDAon");
    const reply = await agent.handle(OWNER, "compra 20 de nvidia", true);
    expect(reply.confirmId).toBeUndefined();
    expect(reply.text).toContain("dividendos");
  });

  it("precio muestra la bolsa y cada token", async () => {
    const reply = await agent.handle(STRANGER, "precio de apple", false);
    expect(reply.text).toContain("En bolsa");
    expect(reply.text).toContain("AAPLx");
    expect(reply.text).toContain("bAAPL");
  });
});
