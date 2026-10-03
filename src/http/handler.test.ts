import { beforeEach, describe, expect, it } from "vitest";
import { FileStore } from "../store.js";
import { createHandler, type HttpDeps } from "./handler.js";

const WEBHOOK_SECRET = "s3cret-webhook-0123456789";
const CRON_SECRET = "s3cret-cron-0123456789";

let updates: unknown[];
let dcaRuns: number;
let deps: HttpDeps;

beforeEach(() => {
  updates = [];
  dcaRuns = 0;
  const store = new FileStore("/tmp/no-se-usa.json");
  deps = {
    analyze: async (prompt) => `análisis de ${prompt}`,
    info: async () => ({ name: "Primera Acción", telegram: "@primera_bot" }),
    quotes: async (tickers) => tickers.map((t) => ({ ticker: t })),
    handleTelegramUpdate: async (u) => {
      await new Promise((r) => setTimeout(r, 20));
      updates.push(u);
    },
    runDca: async () => ++dcaRuns,
    hit: (k, w) => store.hit(k, w),
    secrets: { telegramWebhook: WEBHOOK_SECRET, cron: CRON_SECRET },
    limits: { perMinute: 3, perDay: 100 },
  };
});

const req = (path: string, init: RequestInit = {}) => new Request(`https://primera.vercel.app${path}`, init);

describe("handler HTTP", () => {
  it("sirve la página y health", async () => {
    const h = createHandler(deps);
    const page = await h(req("/"));
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("Primera Acción");
    expect(await (await h(req("/health"))).json()).toEqual({ status: "ok" });
  });

  it("/api/analyze por POST y GET, con CORS para otros agentes", async () => {
    const h = createHandler(deps);
    const post = await h(req("/api/analyze", { method: "POST", body: JSON.stringify({ prompt: "NVDA 25" }) }));
    expect(await post.json()).toMatchObject({ result: "análisis de NVDA 25" });
    expect(post.headers.get("access-control-allow-origin")).toBe("*");
    const get = await h(req("/api/analyze?prompt=AAPL"));
    expect((await get.json()).result).toBe("análisis de AAPL");
  });

  it("/api/analyze valida el prompt y limita por IP", async () => {
    const h = createHandler(deps);
    expect((await h(req("/api/analyze", { method: "POST", body: "{}" }))).status).toBe(400);
    expect((await h(req("/api/analyze?prompt=" + "x".repeat(301)))).status).toBe(400);

    const call = () => h(req("/api/analyze?prompt=TSLA", { headers: { "x-forwarded-for": "1.2.3.4" } }));
    for (let i = 0; i < 3; i++) expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(429);
    // Otra IP no se ve afectada.
    expect((await h(req("/api/analyze?prompt=TSLA", { headers: { "x-forwarded-for": "5.6.7.8" } }))).status).toBe(200);
  });

  it("/api/quotes devuelve las cards con cache de CDN y limita los tickers", async () => {
    const h = createHandler(deps);
    const res = await h(req("/api/quotes"));
    expect((await res.json()).items).toEqual([{ ticker: "NVDA" }, { ticker: "AAPL" }, { ticker: "TSLA" }]);
    expect(res.headers.get("cache-control")).toContain("s-maxage");
    const custom = await (await h(req("/api/quotes?t=spy,qqq,<script>,AAPL,MSFT,AMZN"))).json();
    expect(custom.items.map((i: { ticker: string }) => i.ticker)).toEqual(["SPY", "QQQ", "AAPL", "MSFT"]);
  });

  it("webhook de Telegram: rechaza sin el secreto", async () => {
    const h = createHandler(deps);
    const res = await h(req("/api/telegram", { method: "POST", body: JSON.stringify({ update_id: 1 }), headers: { "x-telegram-bot-api-secret-token": "otro" } }));
    expect(res.status).toBe(401);
    expect(updates).toHaveLength(0);
  });

  it("webhook de Telegram: procesa el mensaje antes de responder", async () => {
    const h = createHandler(deps);
    const res = await h(
      req("/api/telegram", { method: "POST", body: JSON.stringify({ update_id: 7 }), headers: { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET } }),
    );
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ update_id: 7 }]); // ya procesado cuando Telegram recibe el 200
  });

  it("webhook de Telegram: si el procesamiento se cuelga, responde 200 al llegar al tope", async () => {
    const err = console.error;
    console.error = () => {};
    try {
      const h = createHandler({ ...deps, telegramBudgetMs: 30, handleTelegramUpdate: () => new Promise(() => {}) });
      const res = await h(req("/api/telegram", { method: "POST", body: "{}", headers: { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET } }));
      expect(res.status).toBe(200);
    } finally {
      console.error = err;
    }
  });

  it("webhook de Telegram: si el procesamiento falla igual responde 200 (Telegram no reintenta en bucle)", async () => {
    const err = console.error;
    console.error = () => {};
    try {
      const h = createHandler({ ...deps, handleTelegramUpdate: async () => { throw new Error("falló"); } });
      const res = await h(req("/api/telegram", { method: "POST", body: "{}", headers: { "x-telegram-bot-api-secret-token": WEBHOOK_SECRET } }));
      expect(res.status).toBe(200);
    } finally {
      console.error = err;
    }
  });

  it("webhook sin secreto configurado no acepta nada", async () => {
    const h = createHandler({ ...deps, secrets: { cron: CRON_SECRET } });
    const res = await h(req("/api/telegram", { method: "POST", body: "{}", headers: { "x-telegram-bot-api-secret-token": "" } }));
    expect(res.status).toBe(503);
  });

  it("cron de DCA solo con el CRON_SECRET de Vercel", async () => {
    const h = createHandler(deps);
    expect((await h(req("/api/cron/dca"))).status).toBe(401);
    expect((await h(req("/api/cron/dca", { headers: { authorization: "Bearer mal" } }))).status).toBe(401);
    const ok = await h(req("/api/cron/dca", { headers: { authorization: `Bearer ${CRON_SECRET}` } }));
    expect(await ok.json()).toEqual({ sent: 1 });
  });

  it("si el análisis falla responde 502 con el motivo", async () => {
    const h = createHandler({ ...deps, analyze: async () => { throw new Error("Binance caído"); } });
    const err = console.error;
    console.error = () => {};
    try {
      const res = await h(req("/api/analyze?prompt=NVDA"));
      expect(res.status).toBe(502);
      expect((await res.json()).error).toBe("Binance caído");
    } finally {
      console.error = err;
    }
  });
});
