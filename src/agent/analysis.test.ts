import { describe, expect, it } from "vitest";
import type { Issuer, StockToken } from "../domain/types.js";
import type { Fundamentals, PriceInfo } from "../ports.js";
import type { StockQuote } from "../stocks/quotes.js";
import { buildAnalysis } from "./analysis.js";

const token = (symbol: string, issuer: Issuer, n: number): StockToken => ({
  ticker: "AAPL",
  symbol,
  name: "Apple",
  issuer,
  address: `0x${n.toString(16).padStart(40, "0")}`,
  decimals: 18,
});
const AAPLX = token("AAPLx", "xstocks", 1);
const BAAPL = token("bAAPL", "bstocks", 2);
const AAPLON = token("AAPLon", "ondo", 3);

// Viernes 2 oct 2026, 18:30 en Nueva York: post-mercado, bolsa cerrada.
const FRIDAY_POST = new Date("2026-10-02T22:30:00Z");
// Lunes 5 oct 2026, 11:00 en Nueva York: sesión regular.
const MONDAY_OPEN = new Date("2026-10-05T15:00:00Z");

const POST_QUOTE: StockQuote = {
  ticker: "AAPL",
  name: "Apple Inc.",
  priceUsd: 256.1,
  at: new Date("2026-10-02T22:25:00Z"),
  session: "post",
  regularPriceUsd: 255.46,
  previousCloseUsd: 252.35,
  source: "Yahoo Finance",
};

const FUNDAMENTALS: Fundamentals = {
  high52w: 260.1,
  low52w: 169.21,
  marketCapUsd: 3.8e12,
  priceToEarnings: 38.2,
  dividendYieldPct: 0.41,
};

function price(t: StockToken, over: Partial<PriceInfo> = {}): PriceInfo {
  const stock = over.stock === undefined ? POST_QUOTE : over.stock;
  const multiplier = over.multiplier ?? 1;
  return {
    token: t,
    onchainUsd: 256,
    referenceUsd: stock ? stock.priceUsd * multiplier : null,
    multiplier,
    stock,
    change24hPct: 0.8,
    session: "closed-overnight",
    tradable: { ok: true, reason: null },
    fundamentals: FUNDAMENTALS,
    ...over,
  };
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Lo que nunca debe aparecer: consejos, juicios de valor, predicciones ni valores rotos. */
const FORBIDDEN = /compra|vende|venta|recomend|conviene|deber[ií]as|barat|\bcar[oa]s?\b|subir[áa]|bajar[áa]|mantener/i;
const BROKEN = /null|NaN|undefined|Infinity/;

function expectClean(text: string) {
  expect(text.trim()).not.toBe("");
  expect(text).not.toMatch(FORBIDDEN);
  expect(text).not.toMatch(BROKEN);
  expect(text).not.toContain("_"); // Markdown legado de Telegram: solo *negrita*.
  expect(text).not.toMatch(/^#/m);
  expect(text.split("\n").length).toBeLessThanOrEqual(6);
}

describe("buildAnalysis", () => {
  it("post-mercado con dos emisores: bolsa, rango de 52 semanas, brecha, el más bajo y bolsa cerrada", () => {
    const text = buildAnalysis(
      [price(AAPLX, { onchainUsd: 256.9 }), price(BAAPL, { onchainUsd: 254 })],
      FRIDAY_POST,
    );
    // a) cierre regular de hoy, cambio del día y precio de post-mercado frente a ese cierre
    expect(text).toContain("*AAPL* cerró hoy en 255,46 USD (+1,23% en el día)");
    expect(text).toContain("en post-mercado está en 256,10 USD (+0,25% vs ese cierre)");
    // b) rango de 52 semanas
    expect(text).toContain("Está en el 95% de su rango de 52 semanas, a 1,78% de su máximo (260,10 USD)");
    // c) brecha por emisor, clasificación, el más bajo frente a la bolsa y nota de bolsa cerrada
    expect(text).toContain("*AAPLx* +0,31% y *bAAPL* -0,82% (brecha moderada)");
    expect(text).toContain("Ahora el que cotiza más bajo frente a la bolsa es *bAAPL* (bStocks).");
    expect(text).toContain("próxima apertura");
    // f) contexto neutral
    expect(text).toContain("Contexto: P/E de 38,2 y dividendo anual de 0,41%.");
    expectClean(text);
    expect(words(text)).toBeLessThanOrEqual(110);
  });

  it("sesión regular: precio en vivo vs cierre anterior, sin nota de bolsa cerrada", () => {
    const live: StockQuote = { ...POST_QUOTE, priceUsd: 255, at: MONDAY_OPEN, session: "regular", regularPriceUsd: 255, previousCloseUsd: 250 };
    const text = buildAnalysis([price(AAPLX, { stock: live, onchainUsd: 255.5, session: "open" })], MONDAY_OPEN);
    expect(text).toContain("*AAPL* cotiza en bolsa a 255,00 USD, +2,00% vs el cierre anterior.");
    expect(text).toContain("*AAPLx* cotiza 0,20% por encima de su valor en bolsa (en línea con la bolsa).");
    expect(text).not.toContain("post-mercado");
    expect(text).not.toContain("bolsa cerrada");
    expect(text).not.toContain("más bajo"); // un solo emisor: no hay comparación entre tokens
    expectClean(text);
  });

  it("pre-mercado: usa el cierre de la última sesión regular", () => {
    const pre: StockQuote = { ...POST_QUOTE, priceUsd: 254.2, at: new Date("2026-10-05T12:00:00Z"), session: "pre" };
    const text = buildAnalysis([price(AAPLX, { stock: pre, onchainUsd: 254.2 })], new Date("2026-10-05T12:05:00Z"));
    expect(text).toContain("*AAPL* cerró su última sesión en 255,46 USD (+1,23% en el día)");
    expect(text).toContain("en pre-mercado está en 254,20 USD (-0,49% vs ese cierre)");
    expectClean(text);
  });

  it("sin precio de bolsa ni fundamentales: no se cae ni muestra valores vacíos", () => {
    const text = buildAnalysis(
      [
        price(AAPLX, { stock: null, fundamentals: null, change24hPct: null, session: "closed-weekend" }),
        price(BAAPL, { stock: null, fundamentals: null, change24hPct: null, session: "closed-weekend" }),
      ],
      FRIDAY_POST,
    );
    expect(text).toContain("No hay precio de bolsa ahora para comparar los tokens con la acción.");
    expect(text).toContain("próxima apertura");
    expect(text).not.toContain("52 semanas");
    expect(text).not.toContain("Contexto");
    expectClean(text);
  });

  it("datos parciales o rotos (sin cierres, referencia 0, fundamentales nulos) se omiten", () => {
    const bare: StockQuote = { ...POST_QUOTE, at: null, session: "unknown", regularPriceUsd: null, previousCloseUsd: null, source: "Binance" };
    const empty: Fundamentals = { high52w: null, low52w: null, marketCapUsd: null, priceToEarnings: null, dividendYieldPct: null };
    const text = buildAnalysis(
      [
        price(AAPLX, { stock: bare, fundamentals: empty, session: "open" }),
        price(BAAPL, { stock: bare, fundamentals: empty, referenceUsd: 0, session: "open" }),
        price(AAPLON, { stock: null, fundamentals: null, referenceUsd: null, multiplier: Number.NaN, session: "open" }),
      ],
      MONDAY_OPEN,
    );
    expect(text).toContain("El último precio de *AAPL* en bolsa es 256,10 USD.");
    expect(text).toContain("*AAPLx* cotiza");
    expect(text).not.toContain("bAAPL"); // referencia 0: sin brecha
    expect(text).not.toContain("52 semanas");
    expect(text).not.toContain("Contexto");
    expectClean(text);
  });

  it("token pausado: dice que no se puede operar y por qué", () => {
    const text = buildAnalysis(
      [
        price(AAPLX, { onchainUsd: 256.2 }),
        price(BAAPL, { onchainUsd: 255.9, tradable: { ok: false, reason: "el emisor pausó este token (pago de dividendos). Vuelve a abrir 2026-10-05 13:30 UTC" } }),
      ],
      FRIDAY_POST,
    );
    expect(text).toContain(
      "*bAAPL* (bStocks) no se puede operar ahora: el emisor pausó este token (pago de dividendos). Vuelve a abrir 2026-10-05 13:30 UTC.",
    );
    expect(text).not.toContain("*AAPLx* (xStocks) no se puede operar");
    expectClean(text);
  });

  it("varios pausados, sin motivo o con motivo crudo: sin null ni guiones bajos", () => {
    const text = buildAnalysis(
      [
        price(AAPLX, { tradable: { ok: false, reason: null } }),
        price(BAAPL, { tradable: { ok: false, reason: "estado ASSET_PAUSED (new_reason)." } }),
      ],
      FRIDAY_POST,
    );
    expect(text).toContain("No se pueden operar ahora: *AAPLx* (xStocks) — sin motivo informado; *bAAPL* (bStocks) — estado ASSET PAUSED (new reason).");
    expectClean(text);
  });

  it("clasifica la mayor brecha: en línea, moderada o alta", () => {
    const quote: StockQuote = { ...POST_QUOTE, priceUsd: 10_000, regularPriceUsd: 10_000, previousCloseUsd: 10_000, session: "regular" };
    const at = (onchainUsd: number) => buildAnalysis([price(AAPLX, { stock: quote, onchainUsd, session: "open", fundamentals: null })], MONDAY_OPEN);
    expect(at(10_049)).toContain("(en línea con la bolsa)");
    expect(at(10_050)).toContain("(brecha moderada)");
    expect(at(9_800)).toContain("(brecha moderada)");
    expect(at(10_201)).toContain("(brecha alta)");

    const high = buildAnalysis(
      [price(AAPLX, { onchainUsd: 282, session: "open" }), price(BAAPL, { onchainUsd: 256.5, session: "open" })],
      MONDAY_OPEN,
    );
    expect(high).toContain("*AAPLx* +10,11% y *bAAPL* +0,16% (brecha alta)");
    expect(high).toContain("cotiza más bajo frente a la bolsa es *bAAPL* (bStocks)");
    expect(high).toContain("liquidez onchain");
    expectClean(high);
  });

  it("con empate en la brecha no nombra un único emisor más bajo", () => {
    const text = buildAnalysis([price(AAPLX), price(BAAPL), price(AAPLON, { onchainUsd: 257 })], FRIDAY_POST);
    expect(text).toContain("*AAPLx* -0,04%, *bAAPL* -0,04% y *AAPLon* +0,35%");
    expect(text).not.toContain("más bajo");
    expectClean(text);
  });

  it("multiplicador: explica cuántas acciones vale 1 token", () => {
    const text = buildAnalysis(
      [price(AAPLX, { multiplier: 1.0123, onchainUsd: 259.3 }), price(BAAPL, { multiplier: 1.0005 })],
      FRIDAY_POST,
    );
    expect(text).toContain("1 *AAPLx* equivale a 1,0123 acciones (dividendos reinvertidos o splits del emisor)");
    expect(text).toContain("la brecha ya lo considera");
    expect(text).not.toContain("1 *bAAPL*"); // 1,0005 está dentro de la tolerancia
    expectClean(text);
  });

  it("con todos los datos a la vez se mantiene breve (≤ 6 líneas)", () => {
    const text = buildAnalysis(
      [
        price(AAPLX, { onchainUsd: 259.9, multiplier: 1.0123 }),
        price(BAAPL, { onchainUsd: 254, tradable: { ok: false, reason: "el emisor pausó este token (pago de dividendos)" } }),
      ],
      FRIDAY_POST,
    );
    expect(text.split("\n")).toHaveLength(6);
    expect(words(text)).toBeLessThanOrEqual(130); // peor caso: los 6 puntos a la vez
    expectClean(text);
  });

  it("nunca recomienda ni juzga, en ningún escenario", () => {
    const sessions = ["open", "closed-weekend", "closed-holiday", "closed-overnight"] as const;
    const quotes: (StockQuote | null)[] = [
      POST_QUOTE,
      { ...POST_QUOTE, session: "regular" },
      { ...POST_QUOTE, session: "pre" },
      { ...POST_QUOTE, session: "closed", priceUsd: 255.9 },
      null,
    ];
    for (const session of sessions) {
      for (const stock of quotes) {
        for (const onchainUsd of [200, 255, 256.1, 300]) {
          const text = buildAnalysis(
            [
              price(AAPLX, { stock, session, onchainUsd, multiplier: 1.02 }),
              price(BAAPL, { stock, session, tradable: { ok: false, reason: "el mercado está en pausa" } }),
            ],
            FRIDAY_POST,
          );
          expectClean(text);
        }
      }
    }
    expect(buildAnalysis([])).toBe("");
  });
});

describe("toTelegramMarkdown", () => {
  it("convierte el Markdown del LLM al de Telegram", async () => {
    const { toTelegramMarkdown } = await import("../i18n/es.js");
    const out = toTelegramMarkdown("**AAPL en bolsa**  \n## Tokens\n- **AAPLon** +0,04%\n\n\n\nfin");
    expect(out).toBe("*AAPL en bolsa*\n*Tokens*\n• *AAPLon* +0,04%\n\nfin");
  });
});
