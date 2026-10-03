import { timingSafeEqual } from "node:crypto";
import { PAGE_HTML } from "./page.js";
import { parseTickers } from "./quotes.js";

export interface HttpDeps {
  /** Análisis pre-compra (el mismo trabajo que vende el agente de Agent Studio). */
  analyze(prompt: string): Promise<string>;
  info(): Promise<Record<string, unknown>>;
  /** Cards de precios en vivo para la landing (sin LLM). */
  quotes(tickers: string[]): Promise<unknown[]>;
  /** null si no hay TELEGRAM_BOT_TOKEN. */
  handleTelegramUpdate: ((update: unknown) => Promise<void>) | null;
  /** null si no hay bot (el DCA manda mensajes por Telegram). */
  runDca: (() => Promise<number>) | null;
  /** Contador con ventana para rate limit. */
  hit(key: string, windowSec: number): Promise<number>;
  /** En Vercel mantiene viva la función después de responder (Fluid compute). */
  waitUntil(promise: Promise<unknown>): void;
  secrets: { telegramWebhook?: string; cron?: string };
  limits: { perMinute: number; perDay: number };
  now?: () => Date;
}

const MAX_PROMPT = 300;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

function safeEqual(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "anon";
}

export function createHandler(deps: HttpDeps): (req: Request) => Promise<Response> {
  const now = deps.now ?? (() => new Date());

  async function analyze(req: Request): Promise<Response> {
    let prompt: string | null = null;
    if (req.method === "GET") {
      prompt = new URL(req.url).searchParams.get("prompt");
    } else {
      const body = (await req.json().catch(() => null)) as { prompt?: unknown } | null;
      prompt = typeof body?.prompt === "string" ? body.prompt : null;
    }
    prompt = prompt?.trim() ?? "";
    if (!prompt || prompt.length > MAX_PROMPT) {
      return json({ error: `Envía {"prompt": "..."} con 1 a ${MAX_PROMPT} caracteres. Ej: "NVDA 25" o "analiza apple".` }, 400, CORS);
    }

    const minute = await deps.hit(`analyze:ip:${clientIp(req)}`, 60);
    if (minute > deps.limits.perMinute) {
      return json({ error: "Demasiadas consultas. Espera un minuto." }, 429, { ...CORS, "Retry-After": "60" });
    }
    const day = await deps.hit(`analyze:day:${now().toISOString().slice(0, 10)}`, 86_400);
    if (day > deps.limits.perDay) {
      return json({ error: "Se alcanzó el límite diario de análisis. Vuelve mañana." }, 429, CORS);
    }

    try {
      return json({ result: await deps.analyze(prompt), format: "telegram-markdown" }, 200, CORS);
    } catch (err) {
      console.error("[analyze]", err);
      return json({ error: (err as Error).message }, 502, CORS);
    }
  }

  async function telegram(req: Request): Promise<Response> {
    if (!deps.handleTelegramUpdate) return json({ error: "Falta TELEGRAM_BOT_TOKEN" }, 503);
    if (!deps.secrets.telegramWebhook) return json({ error: "Falta TELEGRAM_WEBHOOK_SECRET" }, 503);
    if (!safeEqual(req.headers.get("x-telegram-bot-api-secret-token"), deps.secrets.telegramWebhook)) {
      return json({ error: "unauthorized" }, 401);
    }
    const update = await req.json().catch(() => null);
    if (!update) return json({ error: "update inválido" }, 400);

    // Respondemos al instante para que Telegram no reintente mientras se ejecuta una compra
    // (puede tardar más de un minuto); el trabajo sigue con waitUntil.
    const handle = deps.handleTelegramUpdate;
    deps.waitUntil(handle(update).catch((err) => console.error("[telegram]", err)));
    return json({ ok: true });
  }

  async function cron(req: Request): Promise<Response> {
    if (!deps.secrets.cron || !safeEqual(req.headers.get("authorization"), `Bearer ${deps.secrets.cron}`)) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!deps.runDca) return json({ error: "Falta TELEGRAM_BOT_TOKEN" }, 503);
    return json({ sent: await deps.runDca() });
  }

  return async function handler(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    try {
      if (pathname === "/" && req.method === "GET") {
        return new Response(PAGE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      if (pathname === "/health") return json({ status: "ok" });
      if (pathname === "/api/info" && req.method === "GET") return json(await deps.info(), 200, CORS);
      if (pathname === "/api/quotes" && req.method === "GET") {
        const tickers = parseTickers(new URL(req.url).searchParams.get("t"), ["NVDA", "AAPL", "TSLA"]);
        // Cache en el CDN de Vercel: muchas visitas no multiplican las consultas a Binance y Yahoo.
        return json({ updatedAt: (deps.now ?? (() => new Date()))().toISOString(), items: await deps.quotes(tickers) }, 200, {
          ...CORS,
          "Cache-Control": "public, s-maxage=20, stale-while-revalidate=40",
        });
      }
      if (pathname === "/api/analyze") {
        if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
        if (req.method === "GET" || req.method === "POST") return await analyze(req);
      }
      if (pathname === "/api/telegram" && req.method === "POST") return await telegram(req);
      if (pathname === "/api/cron/dca" && req.method === "GET") return await cron(req);
      return json({ error: "not found" }, 404);
    } catch (err) {
      console.error("[http]", err);
      return json({ error: "error interno" }, 500);
    }
  };
}
