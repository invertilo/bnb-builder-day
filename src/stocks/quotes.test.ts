import { describe, expect, it } from "vitest";
import { FallbackQuotes, parseYahooChart, type StockQuote, type StockQuoteProvider } from "./quotes.js";

// Viernes 2 oct 2026: regular 13:30–20:00 UTC, post 20:00–24:00 UTC.
const periods = {
  pre: { start: 1790928000, end: 1790947800 },
  regular: { start: 1790947800, end: 1790971200 },
  post: { start: 1790971200, end: 1790985600 },
};

describe("parseYahooChart", () => {
  it("toma el último precio de post-mercado y conserva el cierre regular", () => {
    const q = parseYahooChart("NVDA", {
      chart: {
        error: null,
        result: [
          {
            meta: { regularMarketPrice: 233.95, regularMarketTime: 1790971201, previousClose: 230.86, longName: "NVIDIA Corporation", currentTradingPeriod: periods },
            timestamp: [1790971100, 1790985540, 1790985560],
            indicators: { quote: [{ close: [233.9, 234.22, null] }] },
          },
        ],
      },
    })!;
    expect(q.priceUsd).toBe(234.22);
    expect(q.session).toBe("post");
    expect(q.regularPriceUsd).toBe(233.95);
    expect(q.previousCloseUsd).toBe(230.86);
    expect(q.name).toBe("NVIDIA Corporation");
    expect(q.at?.toISOString()).toBe(new Date(1790985540 * 1000).toISOString());
  });

  it("en sesión regular marca 'regular'", () => {
    const q = parseYahooChart("AAPL", {
      chart: {
        error: null,
        result: [{ meta: { regularMarketPrice: 300, regularMarketTime: 1790950000, currentTradingPeriod: periods }, indicators: { quote: [{ close: [] }] } }],
      },
    })!;
    expect(q.session).toBe("regular");
    expect(q.priceUsd).toBe(300);
  });

  it("ticker inexistente → null", () => {
    expect(parseYahooChart("XXXX", { chart: { result: null, error: { description: "No data found" } } })).toBeNull();
  });
});

describe("FallbackQuotes", () => {
  it("si la primera fuente falla usa la segunda", async () => {
    const broken: StockQuoteProvider = { quote: async () => { throw new Error("caída"); } };
    const backup: StockQuote = { ticker: "AAPL", name: null, priceUsd: 1, at: null, session: "unknown", regularPriceUsd: null, previousCloseUsd: null, source: "Binance" };
    const ok: StockQuoteProvider = { quote: async () => backup };
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(await new FallbackQuotes([broken, ok]).quote("AAPL")).toBe(backup);
    } finally {
      console.warn = warn;
    }
  });
});
