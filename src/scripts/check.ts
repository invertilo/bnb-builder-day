/**
 * Diagnóstico sin Telegram: npm run check [TICKER] [MONTO_USDT]
 * Prueba catálogo, precio de bolsa, IA, firma de la API de Binance, wallet y (opcional) una cotización.
 * Nunca ejecuta operaciones ni imprime claves.
 */
import { INTENT_PROMPT } from "../agent/prompts.js";
import { buildApp } from "../app.js";
import { BinanceWeb3 } from "../binance/auth.js";
import { loadConfig } from "../config.js";

try {
  process.loadEnvFile();
} catch {
  /* sin .env */
}

const cfg = loadConfig({ ...process.env, TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "no-necesario-para-check" });
const app = buildApp(cfg);
const ticker = (process.argv[2] ?? "NVDA").toUpperCase();
const quoteUsd = process.argv[3] ? Number(process.argv[3]) : null;

async function step(name: string, fn: () => Promise<string | null>): Promise<void> {
  const t0 = Date.now();
  try {
    const out = await fn();
    if (out === null) console.log(`⏭️  ${name}: omitido`);
    else console.log(`✅ ${name} (${Date.now() - t0} ms)\n${indent(out)}`);
  } catch (err) {
    console.log(`❌ ${name} (${Date.now() - t0} ms): ${(err as Error).message}`);
  }
}

const indent = (s: string) => s.split("\n").map((l) => `   ${l}`).join("\n");

await step("Catálogo de acciones tokenizadas en BSC", async () => {
  const all = await app.market.listStocks();
  const by = all.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.issuer]: (acc[t.issuer] ?? 0) + 1 }), {});
  const hits = await app.market.findStock(ticker);
  return `${all.length} tokens ${JSON.stringify(by)} · ${ticker}: ${hits.map((t) => t.symbol).join(", ") || "no disponible"}`;
});

await step(`Precio en bolsa y onchain de ${ticker}`, async () => (await app.agent.handle(0, `precio ${ticker}`, false)).text);

await step(`IA (${cfg.LLM_MODEL})`, async () => {
  if (!app.llm) return null;
  const intent = await app.llm.json(INTENT_PROMPT, "quiero meterle 25 dólares a nvidia");
  return `"quiero meterle 25 dólares a nvidia" → ${JSON.stringify(intent)}`;
});

await step("Binance Web3 API (firma HMAC)", async () => {
  if (!cfg.BINANCE_API_KEY || !cfg.BINANCE_API_SECRET) return null;
  const [token] = await app.market.findStock(ticker);
  if (!token) return `${ticker} no está en el catálogo`;
  const api = new BinanceWeb3({ apiKey: cfg.BINANCE_API_KEY, apiSecret: cfg.BINANCE_API_SECRET });
  const data = await api.get<unknown>("/api/v1/dex/market/rwa/price", { binanceChainId: 56, tokenContractAddresses: token.address });
  return JSON.stringify(data).slice(0, 400);
});

await step("Wallet del agente", async () => {
  if (!app.tradingEnabled) return null;
  const pf = await app.trader.portfolio();
  return `${pf.address} · ${pf.bnb.toFixed(5)} BNB · ${pf.stableUsd.toFixed(2)} USDT · ${pf.positions.length} posiciones`;
});

await step(`Cotización de compra ${quoteUsd ?? "-"} USDT de ${ticker} (sin ejecutar)`, async () => {
  if (!quoteUsd || !app.tradingEnabled) return null;
  const [token] = await app.market.findStock(ticker);
  if (!token) return `${ticker} no está en el catálogo`;
  const q = await app.trader.quote(token, "buy", quoteUsd);
  const sim = await app.trader.simulate(q);
  return [
    `${q.token.symbol}: ${q.usd} USDT → ${q.tokenAmount} tokens · ruta ${q.route} · impacto ${q.priceImpactBps ?? "?"} pb`,
    `chequeo ${sim.kind}: ${sim.ok ? "OK" : `FALLA: ${sim.error}`}${sim.notes.length ? ` · ${sim.notes.join(" · ")}` : ""}`,
  ].join("\n");
});
