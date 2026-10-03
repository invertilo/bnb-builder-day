import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BinanceWeb3, encodeQuery, sign } from "./auth.js";
import { BinanceApiError } from "./errors.js";

const NOW = new Date("2026-10-03T12:00:00.123Z");

function fakeFetch(response: { status?: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(response.body), { status: response.status ?? 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("firma HMAC", () => {
  it("encodeQuery usa %20 y omite vacíos", () => {
    expect(encodeQuery({ a: "x y", b: undefined, c: "", d: 5 })).toBe("a=x%20y&d=5");
  });

  it("firma timestamp + método + ruta con /build + query", async () => {
    const { impl, calls } = fakeFetch({ body: { code: 0, msg: "success", data: { ok: true } } });
    const api = new BinanceWeb3({ apiKey: "k", apiSecret: "s" }, impl, () => NOW);
    const data = await api.get<{ ok: boolean }>("/api/v1/dex/aggregator/quote", { binanceChainId: "56", amount: "10" });
    expect(data).toEqual({ ok: true });

    const { url, init } = calls[0]!;
    expect(url).toBe("https://web3.binance.com/build/api/v1/dex/aggregator/quote?binanceChainId=56&amount=10");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-OC-APIKEY"]).toBe("k");
    expect(headers["X-OC-TIMESTAMP"]).toBe("2026-10-03T12:00:00.123Z");
    const expected = createHmac("sha256", "s")
      .update("2026-10-03T12:00:00.123ZGET/build/api/v1/dex/aggregator/quote?binanceChainId=56&amount=10")
      .digest("base64");
    expect(headers["X-OC-SIGN"]).toBe(expected);
  });

  it("en POST firma el body exacto que envía", async () => {
    const { impl, calls } = fakeFetch({ body: { code: 0, data: null } });
    const api = new BinanceWeb3({ apiKey: "k", apiSecret: "s" }, impl, () => NOW);
    await api.post("/api/v1/dex/pre-transaction/simulate", { binanceChainId: "56" });
    const { init } = calls[0]!;
    const sig = (init.headers as Record<string, string>)["X-OC-SIGN"];
    expect(sig).toBe(sign("s", NOW.toISOString(), "POST", "/build/api/v1/dex/pre-transaction/simulate", init.body as string));
  });

  it("HTTP 200 con code ≠ 0 es un error con mensaje en español", async () => {
    const { impl } = fakeFetch({ body: { code: 40375, msg: "Minimum order amount is 20 USD.", data: null } });
    const api = new BinanceWeb3({ apiKey: "k", apiSecret: "s" }, impl, () => NOW);
    const err = await api.get("/x").catch((e) => e);
    expect(err).toBeInstanceOf(BinanceApiError);
    expect(err.message).toContain("20 USD");
  });

  it("429 se informa como límite de solicitudes", async () => {
    const { impl } = fakeFetch({ status: 429, body: {} });
    const api = new BinanceWeb3({ apiKey: "k", apiSecret: "s" }, impl, () => NOW);
    await expect(api.get("/x")).rejects.toThrow("Demasiadas solicitudes");
  });
});
