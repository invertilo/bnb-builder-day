import { IntentSchema, parseIntentRules } from "../agent/intents.js";
import { INTENT_PROMPT } from "../agent/prompts.js";
import type { App } from "../app.js";
import { gapBps } from "../domain/policy.js";
import * as es from "../i18n/es.js";

/**
 * Trabajo que vende el agente en BNB Agent Studio (hook `runWork` del seller A2A / x402):
 * un análisis pre-compra de una acción tokenizada para otros agentes o personas.
 * Es de SOLO LECTURA: cotiza pero nunca firma ni ejecuta (regla de Agent Studio: la firma vive en código fijo).
 *
 * Entrada: texto libre, ej. "NVDA 25", "analiza apple", "¿conviene comprar 50 de tesla ahora?".
 */
export function createStudioRunWork(app: Pick<App, "agent" | "market" | "trader" | "llm" | "tradingEnabled">) {
  return async function runWork(prompt: string): Promise<string> {
    const { ticker, usd } = await understand(app, prompt);
    if (!ticker) return "Indica una acción y, si quieres, un monto. Ej: `NVDA 25` o `analiza apple`.";

    const analysis = (await app.agent.handle(0, `analiza ${ticker}`, false)).text;
    if (!usd || !app.tradingEnabled) return analysis;

    const tokens = await app.market.findStock(ticker);
    const lines = await Promise.all(
      tokens.map(async (t) => {
        try {
          const [q, p] = await Promise.all([app.trader.quote(t, "buy", usd), app.market.price(t)]);
          const effective = q.usd / q.tokenAmount;
          const gap = p.referenceUsd ? ` (${es.signedPct(gapBps(effective, p.referenceUsd))} vs bolsa)` : "";
          const impact = q.priceImpactBps !== null ? ` · impacto ${es.pct(q.priceImpactBps)}` : "";
          return `• *${t.symbol}*: ${es.usd(usd)} → ${es.units(q.tokenAmount)} tokens a ${es.usd(effective)}${gap}${impact} · ${q.route}`;
        } catch (err) {
          return `• *${t.symbol}*: sin cotización (${(err as Error).message})`;
        }
      }),
    );
    return `${analysis}\n\n💱 *Cotización para ${es.usd(usd)}* (sin ejecutar)\n${lines.join("\n")}`;
  };
}

async function understand(app: Pick<App, "llm">, prompt: string): Promise<{ ticker: string | null; usd: number | null }> {
  const simple = prompt.trim().match(/^([A-Za-z.]{1,10})(?:\s+(\d+(?:[.,]\d+)?))?$/);
  if (simple) return { ticker: simple[1]!.toUpperCase(), usd: simple[2] ? Number(simple[2].replace(",", ".")) : null };

  let intent = parseIntentRules(prompt);
  if (!intent && app.llm) {
    const parsed = IntentSchema.safeParse(await app.llm.json(INTENT_PROMPT, prompt).catch(() => null));
    intent = parsed.success ? parsed.data : null;
  }
  if (!intent) return { ticker: null, usd: null };
  switch (intent.kind) {
    case "buy":
      return { ticker: intent.ticker, usd: intent.usd };
    case "price":
    case "analyze":
      return { ticker: intent.ticker, usd: null };
    case "sell":
      return { ticker: intent.ticker, usd: typeof intent.usd === "number" ? intent.usd : null };
    default:
      return { ticker: null, usd: null };
  }
}
