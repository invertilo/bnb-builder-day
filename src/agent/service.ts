import { randomUUID } from "node:crypto";
import { assertValidBasket, BASKET_TEMPLATES, BasketError, describeWeights, normalizeWeights } from "../domain/baskets.js";
import { usMarketSession } from "../domain/market-hours.js";
import { checkTrade, gapBps, type TradePolicy } from "../domain/policy.js";
import { planRebalance } from "../domain/rebalance.js";
import type { Basket, PlannedTrade, StockToken } from "../domain/types.js";
import * as es from "../i18n/es.js";
import type { Llm, MarketData, Quote, Trader } from "../ports.js";
import type { Store } from "../store.js";
import { IntentSchema, parseIntentRules, resolveTicker, type Intent } from "./intents.js";
import { EXPLAIN_PROMPT, INTENT_PROMPT } from "./prompts.js";

export interface Reply {
  text: string;
  /** Si existe, la UI muestra botones Confirmar / Cancelar para esta operación pendiente. */
  confirmId?: string;
}

interface Pending {
  userId: number;
  quotes: Quote[];
  createdAt: number;
  label: string;
}

const PUBLIC_INTENTS = new Set<Intent["kind"]>(["price", "explain", "help", "unknown", "basket_list"]);

/** Cotizaciones más viejas que esto se vuelven a pedir antes de ejecutar. */
const QUOTE_TTL_MS = 60_000;

export interface AgentDeps {
  market: MarketData;
  trader: Trader;
  llm: Llm | null;
  store: Store;
  policy: TradePolicy;
  minTradeUsd: number;
  now?: () => Date;
}

export class PrimeraAccion {
  private pending = new Map<string, Pending>();
  private readonly now: () => Date;

  constructor(private readonly deps: AgentDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** `canTrade` = false deja solo consultas públicas (precios, preguntas, plantillas). */
  async handle(userId: number, message: string, canTrade: boolean): Promise<Reply> {
    const intent = await this.understand(message);
    if (!canTrade && !PUBLIC_INTENTS.has(intent.kind)) {
      return {
        text: `🔒 Este agente opera con una wallet privada. Puedes consultar precios y hacer preguntas, pero no operar ni ver el portafolio.\n\nTu ID de Telegram es \`${userId}\`.`,
      };
    }
    try {
      return await this.dispatch(userId, intent);
    } catch (err) {
      if (err instanceof BasketError) return { text: `⚠️ ${err.message}` };
      throw err;
    }
  }

  private async understand(message: string): Promise<Intent> {
    const byRules = parseIntentRules(message);
    if (byRules) return byRules;
    if (!this.deps.llm) return { kind: "unknown" };
    try {
      const raw = await this.deps.llm.json(INTENT_PROMPT, message);
      const parsed = IntentSchema.safeParse(raw);
      return parsed.success ? parsed.data : { kind: "unknown" };
    } catch {
      return { kind: "unknown" };
    }
  }

  private async dispatch(userId: number, intent: Intent): Promise<Reply> {
    switch (intent.kind) {
      case "help":
        return { text: es.HELP };
      case "unknown":
        return { text: "No entendí 🤔. Prueba con `compra 10 de apple` o escribe /ayuda." };
      case "explain":
        return this.explain(intent.question);
      case "price":
        return this.priceReply(intent.ticker);
      case "portfolio":
        return this.portfolioReply();
      case "history":
        return this.historyReply(userId);
      case "buy": {
        const ticker = resolveTicker(intent.ticker);
        // "invierte 50 en chips": si no es una acción pero sí una canasta, compramos la canasta.
        if ((await this.deps.market.findStock(ticker)).length === 0) {
          const basket = await this.findBasket(userId, intent.ticker).catch(() => null);
          if (basket) return this.basketBuy(userId, basket.id, intent.usd);
        }
        return this.prepareTrades(userId, [{ ticker, side: "buy", usd: intent.usd }], `Comprar ${es.usd(intent.usd)} de ${ticker}`);
      }
      case "sell":
        return this.prepareSell(userId, resolveTicker(intent.ticker), intent.usd);
      case "basket_list":
        return this.basketListReply(userId);
      case "basket_create":
        return this.createBasket(userId, intent.name, intent.weights);
      case "basket_buy":
        return this.basketBuy(userId, intent.basket, intent.usd);
      case "basket_rebalance":
        return this.basketRebalance(userId, intent.basket);
      case "dca_create":
        return this.createDca(userId, intent.basket, intent.usd, intent.everyDays);
    }
  }

  // ── Consultas ──────────────────────────────────────────────────────────────

  private async explain(question: string): Promise<Reply> {
    if (/tokeniz/i.test(question) || !this.deps.llm) return { text: es.WHAT_IS_TOKENIZED };
    const answer = await this.deps.llm.text(EXPLAIN_PROMPT, question);
    return { text: `${answer}\n\n_${es.DISCLAIMER}_` };
  }

  private async resolveTokens(ticker: string): Promise<StockToken[]> {
    const tokens = await this.deps.market.findStock(ticker);
    if (tokens.length === 0) throw new BasketError(`No encontré ${ticker} entre las acciones tokenizadas disponibles en BSC.`);
    return tokens;
  }

  private async priceReply(ticker: string): Promise<Reply> {
    const tokens = await this.resolveTokens(resolveTicker(ticker));
    const lines = await Promise.all(
      tokens.map(async (t) => {
        const p = await this.deps.market.price(t);
        const ref = p.referenceUsd ? ` · referencia ${es.usd(p.referenceUsd)} (${es.pct(gapBps(p.onchainUsd, p.referenceUsd))})` : "";
        return `• *${t.symbol}* (${t.issuer}): ${es.usd(p.onchainUsd)}${ref}`;
      }),
    );
    return { text: `📈 *${tokens[0]!.name}*\n${lines.join("\n")}\n\n${es.sessionLabel(usMarketSession(this.now()))}` };
  }

  private async portfolioReply(): Promise<Reply> {
    const pf = await this.deps.trader.portfolio();
    const total = pf.stableUsd + pf.positions.reduce((s, p) => s + p.valueUsd, 0);
    const rows = pf.positions
      .sort((a, b) => b.valueUsd - a.valueUsd)
      .map((p) => `• *${p.token.symbol}*: ${es.units(p.units)} → ${es.usd(p.valueUsd)}`);
    return {
      text: [
        `💼 *Tu portafolio* (\`${pf.address.slice(0, 6)}…${pf.address.slice(-4)}\`)`,
        rows.length ? rows.join("\n") : "_Todavía no tienes acciones._",
        `• USDT disponible: ${es.usd(pf.stableUsd)}`,
        `• BNB para gas: ${es.units(pf.bnb)}`,
        `\n*Total:* ${es.usd(total)}`,
      ].join("\n"),
    };
  }

  private async historyReply(userId: number): Promise<Reply> {
    const trades = await this.deps.store.history(userId);
    if (!trades.length) return { text: "Todavía no hiciste operaciones." };
    const rows = trades.map(
      (t) => `• ${t.at.slice(0, 16).replace("T", " ")} ${t.side === "buy" ? "🟢 compra" : "🔴 venta"} ${t.tokenSymbol} ${es.usd(t.usd)} — [tx](${this.deps.trader.explorerTxUrl(t.txHash)})`,
    );
    return { text: `🧾 *Últimas operaciones*\n${rows.join("\n")}` };
  }

  // ── Canastas y DCA ─────────────────────────────────────────────────────────

  private async findBasket(userId: number, name: string): Promise<Basket> {
    const key = slug(name);
    const mine = await this.deps.store.baskets(userId);
    const basket =
      mine.find((b) => b.id === key || slug(b.name) === key) ??
      BASKET_TEMPLATES.find((b) => b.id === key || slug(b.name) === key);
    if (!basket) throw new BasketError(`No encontré la canasta "${name}". Escribe /canastas para ver las tuyas.`);
    return basket;
  }

  private async basketListReply(userId: number): Promise<Reply> {
    const mine = await this.deps.store.baskets(userId);
    const fmt = (b: Basket) => `• *${b.name}* (\`${b.id}\`): ${describeWeights(b.weights)}`;
    return {
      text: [
        "🧺 *Tus canastas*",
        mine.length ? mine.map(fmt).join("\n") : "_Todavía no creaste ninguna._",
        "\n*Plantillas* (ejemplos, ajústalas a tu gusto):",
        BASKET_TEMPLATES.map(fmt).join("\n"),
        "\nCrea una: `canasta chips NVDA 40 AMD 30 TSM 30`",
      ].join("\n"),
    };
  }

  private async createBasket(userId: number, name: string, raw: Record<string, number>): Promise<Reply> {
    const weights = normalizeWeights(Object.fromEntries(Object.entries(raw).map(([t, w]) => [resolveTicker(t), w])));
    const missing: string[] = [];
    for (const t of Object.keys(weights)) if ((await this.deps.market.findStock(t)).length === 0) missing.push(t);
    if (missing.length) throw new BasketError(`Estas acciones no están tokenizadas en BSC: ${missing.join(", ")}`);

    const basket: Basket = { id: slug(name), name, weights };
    assertValidBasket(basket);
    await this.deps.store.upsertBasket(userId, basket);
    return { text: `✅ Canasta *${name}* guardada: ${describeWeights(weights)}\n\nCompra con: \`invierte 50 en ${basket.id}\`` };
  }

  private async basketBuy(userId: number, name: string, amount: number): Promise<Reply> {
    const basket = await this.findBasket(userId, name);
    const plan = planRebalance({
      weights: basket.weights,
      holdingsUsd: {},
      cashUsd: amount,
      minTradeUsd: this.deps.minTradeUsd,
      driftTolerance: 1,
    });
    return this.prepareTrades(userId, plan.trades, `Invertir ${es.usd(amount)} en la canasta ${basket.name}`);
  }

  private async basketRebalance(userId: number, name: string): Promise<Reply> {
    const basket = await this.findBasket(userId, name);
    const pf = await this.deps.trader.portfolio();
    const holdingsUsd: Record<string, number> = {};
    for (const p of pf.positions) holdingsUsd[p.token.ticker] = (holdingsUsd[p.token.ticker] ?? 0) + p.valueUsd;
    const plan = planRebalance({
      weights: basket.weights,
      holdingsUsd,
      cashUsd: 0,
      minTradeUsd: this.deps.minTradeUsd,
      driftTolerance: 0.05,
    });
    if (!plan.trades.length) return { text: `👌 La canasta *${basket.name}* está balanceada (desvío menor a 5 pp).` };
    return this.prepareTrades(userId, plan.trades, `Rebalancear la canasta ${basket.name}`);
  }

  private async createDca(userId: number, name: string, amount: number, everyDays: number): Promise<Reply> {
    const basket = await this.findBasketOrSingle(userId, name);
    await this.deps.store.upsertDca({
      id: `${basket.id}-${everyDays}d`,
      userId,
      basketId: basket.id,
      usd: amount,
      everyDays,
      nextRunAt: this.now().toISOString(),
    });
    return {
      text: `🔁 Listo: cada ${everyDays} día(s) te voy a proponer invertir ${es.usd(amount)} en *${basket.name}*. Cada compra te la confirmo antes de ejecutarla.`,
    };
  }

  /** Para DCA en una sola acción ("cada semana 10 de apple") creamos una canasta de un ticker. */
  private async findBasketOrSingle(userId: number, name: string): Promise<Basket> {
    try {
      return await this.findBasket(userId, name);
    } catch {
      const ticker = resolveTicker(name);
      await this.resolveTokens(ticker);
      const basket: Basket = { id: slug(ticker), name: ticker, weights: { [ticker]: 1 } };
      await this.deps.store.upsertBasket(userId, basket);
      return basket;
    }
  }

  /** Llamado por el scheduler: devuelve propuestas de DCA vencidas, listas para confirmar. */
  async dueDcaProposals(): Promise<{ userId: number; reply: Reply }[]> {
    const now = this.now();
    const out: { userId: number; reply: Reply }[] = [];
    for (const plan of await this.deps.store.dcaPlans()) {
      if (Date.parse(plan.nextRunAt) > now.getTime()) continue;
      const next = new Date(now.getTime() + plan.everyDays * 86_400_000);
      await this.deps.store.upsertDca({ ...plan, nextRunAt: next.toISOString() });
      try {
        const reply = await this.basketBuy(plan.userId, plan.basketId, plan.usd);
        out.push({ userId: plan.userId, reply: { ...reply, text: `🔁 *Compra programada*\n${reply.text}` } });
      } catch (err) {
        out.push({ userId: plan.userId, reply: { text: `🔁 No pude preparar tu compra programada: ${(err as Error).message}` } });
      }
    }
    return out;
  }

  // ── Operaciones ────────────────────────────────────────────────────────────

  private async prepareSell(userId: number, ticker: string, amount: number | "all"): Promise<Reply> {
    const pf = await this.deps.trader.portfolio();
    const positions = pf.positions.filter((p) => p.token.ticker === ticker);
    if (!positions.length) return { text: `No tienes ${ticker}.` };
    const held = positions.reduce((s, p) => s + p.valueUsd, 0);
    const usd = amount === "all" ? held : Math.min(amount, held);
    return this.prepareTrades(userId, [{ ticker, side: "sell", usd }], `Vender ${es.usd(usd)} de ${ticker}`, amount === "all");
  }

  /** Cotiza, simula y chequea límites. No ejecuta nada: devuelve una confirmación pendiente. */
  private async prepareTrades(userId: number, trades: PlannedTrade[], label: string, sellAll = false): Promise<Reply> {
    if (!trades.length) return { text: `No hay nada para operar (cada orden tiene que ser de al menos ${es.usd(this.deps.minTradeUsd)}).` };

    const quotes: Quote[] = [];
    const lines: string[] = [];
    const warnings = new Set<string>();
    let spent = await this.deps.store.spentLast24h(userId, this.now());

    for (const trade of trades) {
      const quote = await this.bestQuote(trade, sellAll);
      const price = await this.deps.market.price(quote.token);
      const effective = quote.usd / quote.tokenAmount;
      const gap = price.referenceUsd ? gapBps(effective, price.referenceUsd) : null;

      const verdict = checkTrade(this.deps.policy, {
        usd: trade.side === "buy" ? trade.usd : 0.01,
        spentTodayUsd: trade.side === "buy" ? spent : 0,
        slippageBps: quote.priceImpactBps ?? quote.slippageBps,
        referenceGapBps: gap,
      });
      if (!verdict.ok) return { text: `⛔ ${trade.ticker}: ${verdict.reason}` };
      verdict.warnings.forEach((w) => warnings.add(`${trade.ticker}: ${w}`));

      const sim = await this.deps.trader.simulate(quote);
      if (!sim.ok) return { text: `⛔ La simulación de ${quote.token.symbol} falló: ${sim.error ?? "error desconocido"}. No envié nada.` };

      if (trade.side === "buy") spent += trade.usd;
      quotes.push(quote);
      lines.push(
        `${trade.side === "buy" ? "🟢 Compra" : "🔴 Venta"} *${quote.token.symbol}* (${quote.token.issuer}): ${es.usd(quote.usd)} ≈ ${es.units(quote.tokenAmount)} tokens` +
          `\n   precio ${es.usd(effective)}${gap !== null ? ` (${es.pct(gap)} vs referencia)` : ""} · slippage máx ${es.pct(quote.slippageBps)}` +
          (sim.gasUsd !== null ? ` · gas ≈ ${es.usd(sim.gasUsd)}` : ""),
      );
    }

    const session = usMarketSession(this.now());
    if (session !== "open") warnings.add(es.CLOSED_MARKET_WARNING);

    const id = randomUUID().slice(0, 8);
    this.pending.set(id, { userId, quotes, createdAt: Date.now(), label });

    return {
      text: [
        `🧾 *${label}*`,
        lines.join("\n"),
        `\n${es.sessionLabel(session)}`,
        ...[...warnings].map((w) => `⚠️ ${w}`),
        "\n✅ Simulación OK. ¿Confirmas?",
      ].join("\n"),
      confirmId: id,
    };
  }

  /** Si la acción existe en varios emisores, cotiza en todos y elige el que entrega mejor precio vs su referencia. */
  private async bestQuote(trade: PlannedTrade, sellAll: boolean): Promise<Quote> {
    let tokens = await this.resolveTokens(trade.ticker);
    if (trade.side === "sell") {
      const pf = await this.deps.trader.portfolio();
      const held = new Set(pf.positions.filter((p) => p.units > 0).map((p) => p.token.address.toLowerCase()));
      tokens = tokens.filter((t) => held.has(t.address.toLowerCase()));
      if (sellAll && tokens.length > 1) tokens = tokens.slice(0, 1);
    }

    const results = await Promise.allSettled(
      tokens.map(async (t) => {
        const [q, p] = await Promise.all([this.deps.trader.quote(t, trade.side, trade.usd), this.deps.market.price(t)]);
        const effective = q.usd / q.tokenAmount;
        const ref = p.referenceUsd ?? p.onchainUsd;
        // Compra: menor sobreprecio es mejor. Venta: mayor precio es mejor.
        const score = trade.side === "buy" ? effective / ref : ref / effective;
        return { q, score };
      }),
    );
    const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    if (!ok.length) {
      const reason = results.find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason;
      throw new BasketError(`No conseguí cotización para ${trade.ticker}: ${(reason as Error)?.message ?? "sin liquidez"}`);
    }
    ok.sort((a, b) => a.score - b.score);
    return ok[0]!.q;
  }

  async confirm(userId: number, id: string): Promise<Reply> {
    const p = this.pending.get(id);
    if (!p || p.userId !== userId) return { text: "Esa operación ya no está disponible." };
    this.pending.delete(id);

    if (Date.now() - p.createdAt > QUOTE_TTL_MS) {
      return { text: "⏱️ La cotización venció (más de 60 s). Vuelve a pedir la operación para cotizar de nuevo." };
    }

    const done: string[] = [];
    for (const quote of p.quotes) {
      try {
        const { txHash } = await this.deps.trader.execute(quote);
        await this.deps.store.recordTrade({
          at: this.now().toISOString(),
          userId,
          ticker: quote.token.ticker,
          tokenSymbol: quote.token.symbol,
          side: quote.side,
          usd: quote.usd,
          txHash,
        });
        done.push(`✅ ${quote.side === "buy" ? "Compraste" : "Vendiste"} ${quote.token.symbol} por ${es.usd(quote.usd)} — [ver transacción](${this.deps.trader.explorerTxUrl(txHash)})`);
      } catch (err) {
        done.push(`❌ ${quote.token.symbol}: ${(err as Error).message}`);
        break; // no seguimos con el resto si una falla
      }
    }
    return { text: `*${p.label}*\n${done.join("\n")}` };
  }

  cancel(userId: number, id: string): Reply {
    const p = this.pending.get(id);
    if (p?.userId === userId) this.pending.delete(id);
    return { text: "Cancelado. No se envió nada." };
  }
}

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^(mi|la|canasta)\s+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
