import { randomUUID } from "node:crypto";
import { assertValidBasket, BASKET_TEMPLATES, BasketError, describeWeights, normalizeWeights } from "../domain/baskets.js";
import { usMarketSession } from "../domain/market-hours.js";
import { checkTrade, gapBps, type TradePolicy } from "../domain/policy.js";
import { planRebalance } from "../domain/rebalance.js";
import type { Basket, PlannedTrade, StockToken } from "../domain/types.js";
import * as es from "../i18n/es.js";
import type { Llm, MarketData, PriceInfo, Quote, Trader } from "../ports.js";
import type { StateStore } from "../store.js";
import { IntentSchema, parseIntentRules, resolveTicker, type Intent } from "./intents.js";
import { ANALYZE_PROMPT, EXPLAIN_PROMPT, INTENT_PROMPT } from "./prompts.js";

export interface Reply {
  text: string;
  /** Si existe, la UI muestra botones Confirmar / Cancelar para esta operación pendiente. */
  confirmId?: string;
}

/** Una orden a preparar. `token` fija el emisor (ej. al vender lo que ya tienes). */
type TradeRequest = PlannedTrade & { token?: StockToken; all?: boolean };

interface Pending {
  userId: number;
  quotes: Quote[];
  createdAt: number;
  label: string;
}

const PUBLIC_INTENTS = new Set<Intent["kind"]>(["price", "analyze", "explain", "help", "unknown", "basket_list"]);

const round = (n: number, digits = 4) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Las operaciones pendientes se borran solas pasado este tiempo. */
const PENDING_TTL_SEC = 300;

/** Cotizaciones más viejas que esto se vuelven a pedir antes de ejecutar. */
const QUOTE_TTL_MS = 60_000;

export interface AgentDeps {
  market: MarketData;
  trader: Trader;
  llm: Llm | null;
  store: StateStore;
  policy: TradePolicy;
  minTradeUsd: number;
  now?: () => Date;
}

export class PrimeraAccion {
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
      case "analyze":
        return this.analyzeReply(intent.ticker);
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
    if (!this.deps.llm || /^(¿)?qu[ée] es una acci[óo]n tokenizada\??$/i.test(question.trim())) {
      return { text: es.WHAT_IS_TOKENIZED };
    }
    try {
      const answer = await this.deps.llm.text(EXPLAIN_PROMPT, question);
      return { text: `${answer}\n\n_${es.DISCLAIMER}_` };
    } catch (err) {
      console.warn("[explain] LLM:", (err as Error).message);
      return { text: `No pude consultar a la IA ahora. Mientras tanto:\n\n${es.WHAT_IS_TOKENIZED}` };
    }
  }

  private async resolveTokens(ticker: string): Promise<StockToken[]> {
    const tokens = await this.deps.market.findStock(ticker);
    if (tokens.length === 0) throw new BasketError(`No encontré ${ticker} entre las acciones tokenizadas disponibles en BSC.`);
    return tokens;
  }

  private async prices(ticker: string): Promise<PriceInfo[]> {
    const tokens = await this.resolveTokens(resolveTicker(ticker));
    const results = await Promise.allSettled(tokens.map((t) => this.deps.market.price(t)));
    const prices = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    if (!prices.length) throw new BasketError(`No pude obtener el precio de ${ticker} ahora. Intenta en unos segundos.`);
    return prices;
  }

  private async priceReply(ticker: string): Promise<Reply> {
    const prices = await this.prices(ticker);
    return { text: es.priceCard(prices, this.now()) };
  }

  /** Datos reales de bolsa + tokens, explicados por la IA en español (sin recomendar). */
  private async analyzeReply(ticker: string): Promise<Reply> {
    const prices = await this.prices(ticker);
    const card = es.priceCard(prices, this.now());
    const facts = es.fundamentalsBlock(prices[0]!);
    if (!this.deps.llm) return { text: `${card}${facts ? `\n\n${facts}` : ""}` };

    const data = JSON.stringify(
      prices.map((p) => ({
        token: p.token.symbol,
        emisor: p.token.issuer,
        precio_token_usdt: round(p.onchainUsd),
        precio_accion_bolsa_usd: p.stock ? round(p.stock.priceUsd) : null,
        cierre_anterior_usd: p.stock?.previousCloseUsd ?? null,
        hora_precio_bolsa: p.stock?.at?.toISOString() ?? null,
        sesion_precio_bolsa: p.stock?.session ?? null,
        acciones_por_token: round(p.multiplier, 6),
        brecha_vs_bolsa_pct: p.referenceUsd ? gapBps(p.onchainUsd, p.referenceUsd) / 100 : null,
        cambio_token_24h_pct: p.change24hPct,
        operable: p.tradable.ok,
        motivo_no_operable: p.tradable.reason,
        fundamentales: p.fundamentals,
      })),
    );
    const session = es.sessionLabel(usMarketSession(this.now()));
    try {
      const analysis = await this.deps.llm.text(ANALYZE_PROMPT, `Acción: ${ticker}\nEstado de la bolsa: ${session}\nDatos: ${data}`);
      return { text: `${card}\n\n🧠 *Análisis*\n${analysis}\n\n_${es.DISCLAIMER}_` };
    } catch (err) {
      // Si la IA falla, los datos reales igual sirven: no tumbamos la respuesta.
      console.warn("[analyze] LLM:", (err as Error).message);
      return { text: `${card}${facts ? `\n\n${facts}` : ""}\n\n_El análisis con IA no está disponible en este momento._` };
    }
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
    const positions = pf.positions.filter((p) => p.token.ticker === ticker && p.units > 0);
    if (!positions.length) return { text: `No tienes ${ticker}.` };
    const held = positions.reduce((s, p) => s + p.valueUsd, 0);

    if (amount === "all") {
      // Vender todo: una orden por cada emisor en el que tengas ese ticker.
      const trades = positions.map((p) => ({ ticker, side: "sell" as const, usd: p.valueUsd, token: p.token, all: true }));
      return this.prepareTrades(userId, trades, `Vender todo tu ${ticker} (≈ ${es.usd(held)})`);
    }
    const usd = Math.min(amount, held);
    return this.prepareTrades(userId, [{ ticker, side: "sell", usd }], `Vender ${es.usd(usd)} de ${ticker}`);
  }

  /** Cotiza, simula y chequea límites. No ejecuta nada: devuelve una confirmación pendiente. */
  private async prepareTrades(userId: number, trades: TradeRequest[], label: string): Promise<Reply> {
    if (!trades.length) return { text: `No hay nada para operar (cada orden tiene que ser de al menos ${es.usd(this.deps.minTradeUsd)}).` };

    const quotes: Quote[] = [];
    const lines: string[] = [];
    const warnings = new Set<string>();
    const notes = new Set<string>();
    let allOnchain = true;
    let spent = await this.deps.store.spentLast24h(userId, this.now());

    for (const trade of trades) {
      const { quote, price } = await this.bestQuote(trade);
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
      if (!sim.ok) return { text: `⛔ ${quote.token.symbol}: ${sim.error ?? "los chequeos previos fallaron"}. No envié nada.` };
      sim.notes.forEach((n) => notes.add(n));
      if (sim.kind !== "onchain") allOnchain = false;

      if (trade.side === "buy") spent += trade.usd;
      quotes.push(quote);
      lines.push(
        `${trade.side === "buy" ? "🟢 Compra" : "🔴 Venta"} *${quote.token.symbol}* (${es.issuerName(quote.token.issuer)}): ${es.usd(quote.usd)} ≈ ${es.units(quote.tokenAmount)} tokens` +
          `\n   precio ${es.usd(effective)}${gap !== null ? ` (${es.signedPct(gap)} vs bolsa)` : ""} · slippage máx ${es.pct(quote.slippageBps)}` +
          (quote.priceImpactBps !== null ? ` · impacto ${es.pct(quote.priceImpactBps)}` : "") +
          (sim.gasBnb !== null ? ` · gas ≈ ${sim.gasBnb.toFixed(5)} BNB` : "") +
          `\n   ruta: ${quote.route}`,
      );
    }

    const session = usMarketSession(this.now());
    if (session !== "open") warnings.add(es.CLOSED_MARKET_WARNING);

    const id = randomUUID().slice(0, 8);
    await this.deps.store.savePending(userId, id, { userId, quotes, createdAt: Date.now(), label } satisfies Pending, PENDING_TTL_SEC);

    return {
      text: [
        `🧾 *${label}*`,
        lines.join("\n"),
        `\n${es.sessionLabel(session)}`,
        ...[...warnings].map((w) => `⚠️ ${w}`),
        ...[...notes].map((n) => `ℹ️ ${n}`),
        `\n✅ ${allOnchain ? "Simulación onchain OK" : "Chequeos previos OK"}. ¿Confirmas?`,
      ].join("\n"),
      confirmId: id,
    };
  }

  /**
   * Si la acción existe en varios emisores, cotiza en los que se pueden operar ahora
   * y elige el que da mejor precio frente a la bolsa.
   */
  private async bestQuote(trade: TradeRequest): Promise<{ quote: Quote; price: PriceInfo }> {
    let tokens = trade.token ? [trade.token] : await this.resolveTokens(trade.ticker);
    if (trade.side === "sell" && !trade.token) {
      const pf = await this.deps.trader.portfolio();
      const held = new Set(pf.positions.filter((p) => p.units > 0).map((p) => p.token.address.toLowerCase()));
      tokens = tokens.filter((t) => held.has(t.address.toLowerCase()));
    }

    const results = await Promise.allSettled(
      tokens.map(async (t) => {
        const price = await this.deps.market.price(t);
        if (!price.tradable.ok) throw new Error(`${t.symbol}: ${price.tradable.reason}`);
        const quote = await this.deps.trader.quote(t, trade.side, trade.usd, { all: trade.all });
        const effective = quote.usd / quote.tokenAmount;
        const ref = price.referenceUsd ?? price.onchainUsd;
        // Compra: menor sobreprecio es mejor. Venta: mayor precio es mejor.
        const score = trade.side === "buy" ? effective / ref : ref / effective;
        return { quote, price, score };
      }),
    );
    const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    if (!ok.length) {
      const reasons = results
        .flatMap((r) => (r.status === "rejected" ? [(r.reason as Error)?.message ?? "sin liquidez"] : []))
        .join("; ");
      throw new BasketError(`No conseguí cotización para ${trade.ticker}: ${reasons || "sin liquidez"}`);
    }
    ok.sort((a, b) => a.score - b.score);
    return ok[0]!;
  }

  async confirm(userId: number, id: string): Promise<Reply> {
    // takePending lee y borra en un paso: un segundo clic (o un reintento) no vuelve a ejecutar.
    const p = await this.deps.store.takePending<Pending>(userId, id);
    if (!p || p.userId !== userId) return { text: "Esa operación ya no está disponible." };

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

  async cancel(userId: number, id: string): Promise<Reply> {
    await this.deps.store.takePending(userId, id);
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
