/**
 * Entrada para Vercel (preset de Bun: `Bun.serve()` en src/server.ts + bunVersion en vercel.json).
 * Local: bun run src/server.ts  →  http://localhost:3000
 *
 * Rutas: /  ·  /health  ·  /api/info  ·  /api/analyze  ·  /api/telegram (webhook)  ·  /api/cron/dca (Vercel Cron)
 */
import type { Update } from "grammy/types";
import { botStatus, buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createHandler } from "./http/handler.js";
import { buildQuoteCards } from "./http/quotes.js";
import { createStudioRunWork } from "./studio/run-work.js";
import { createBot, sendDcaProposals } from "./telegram/bot.js";

declare const Bun: {
  serve(options: { port?: number; fetch(req: Request): Response | Promise<Response> }): { port: number };
};

function start(): (req: Request) => Promise<Response> {
  const cfg = loadConfig(process.env, { requireTelegram: false });
  const app = buildApp(cfg);
  const bot = cfg.TELEGRAM_BOT_TOKEN
    ? createBot(app.agent, { token: cfg.TELEGRAM_BOT_TOKEN, traders: cfg.TELEGRAM_TRADER_IDS, status: botStatus(cfg, app) })
    : null;

  // En serverless cada instancia nueva pide getMe una vez; si falla, se reintenta en el próximo request.
  let ready: Promise<void> | null = null;
  const ensureBot = () => (ready ??= bot!.init().catch((err) => ((ready = null), Promise.reject(err))));

  return createHandler({
    analyze: createStudioRunWork(app),
    quotes: (tickers) => buildQuoteCards(app.market, tickers),
    info: async () => ({
      name: "Primera Acción",
      ai: app.llm ? cfg.LLM_MODEL : null,
      trading: app.tradingEnabled,
      issuers: cfg.ISSUERS,
      stockPriceSource: cfg.STOCK_PRICE_SOURCE,
      telegram: bot ? await ensureBot().then(() => `@${bot.botInfo.username}`, () => null) : null,
      endpoints: { analyze: "POST /api/analyze {\"prompt\":\"NVDA 25\"}" },
    }),
    handleTelegramUpdate: bot
      ? async (update) => {
          await ensureBot();
          await bot.handleUpdate(update as Update);
        }
      : null,
    runDca: bot
      ? async () => {
          await ensureBot();
          return sendDcaProposals(bot, app.agent);
        }
      : null,
    hit: (key, windowSec) => app.store.hit(key, windowSec),
    secrets: { telegramWebhook: cfg.TELEGRAM_WEBHOOK_SECRET, cron: cfg.CRON_SECRET },
    limits: { perMinute: cfg.ANALYZE_RATE_LIMIT_PER_MIN, perDay: cfg.ANALYZE_DAILY_LIMIT },
  });
}

let handler: (req: Request) => Promise<Response>;
try {
  handler = start();
} catch (err) {
  // Configuración inválida: respondemos el motivo en vez de caernos en cada request.
  const message = (err as Error).message;
  console.error(message);
  handler = async () => Response.json({ error: message }, { status: 500 });
}

const server = Bun.serve({ port: Number(process.env.PORT ?? 3000), fetch: handler });
console.log(`Primera Acción en :${server.port} · runtime bun ${process.versions.bun ?? "?"}`);
