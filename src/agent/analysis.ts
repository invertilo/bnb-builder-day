import type { MarketSession } from "../domain/market-hours.js";
import { gapBps } from "../domain/policy.js";
import { dollars, issuerName, pct, signedPct, units } from "../i18n/es.js";
import type { Fundamentals, PriceInfo } from "../ports.js";
import type { StockQuote } from "../stocks/quotes.js";

/**
 * Análisis por reglas: el respaldo de ANALYZE_PROMPT cuando la IA no está disponible o responde vacío.
 * Usa solo los datos recibidos. No recomienda comprar, vender ni mantener, y no predice precios.
 */

/** Por debajo de esta brecha (en pb) el token está en línea con la bolsa. */
const IN_LINE_BPS = 50;
/** Por encima de esta brecha (en pb) la brecha es alta. */
const HIGH_GAP_BPS = 200;
/** Desvío mínimo del multiplicador respecto de 1 para explicarlo. */
const MULTIPLIER_EPSILON = 0.001;

/**
 * Devuelve 1 a 6 viñetas en Markdown legado de Telegram (*negrita*), sin título.
 * `prices[0]` es el token principal; todos son el mismo ticker en distintos emisores.
 */
export function buildAnalysis(prices: PriceInfo[], now: Date = new Date()): string {
  const first = prices[0];
  if (!first) return "";
  const stock = prices.find((p) => p.stock)?.stock ?? null;
  const fundamentals = prices.find((p) => p.fundamentals)?.fundamentals ?? null;

  return [
    stockSentence(first.token.ticker, stock, now),
    rangeSentence(stock, fundamentals),
    tokensSentence(prices, first.session),
    multiplierSentence(prices),
    tradableSentence(prices),
    contextSentence(fundamentals),
  ]
    .filter((line): line is string => line !== null)
    .map((line) => `• ${line}`)
    .join("\n");
}

// ── a) La acción en bolsa ────────────────────────────────────────────────────

function stockSentence(ticker: string, q: StockQuote | null, now: Date): string | null {
  if (!q || !isPrice(q.priceUsd)) return null;
  const name = bold(ticker);
  const prev = isPrice(q.previousCloseUsd) ? q.previousCloseUsd : null;
  const vsPrev = (price: number) => (prev !== null ? `${signedPct(gapBps(price, prev))} vs el cierre anterior` : null);

  if (q.session === "regular") {
    const change = vsPrev(q.priceUsd);
    return `${name} cotiza en bolsa a ${dollars(q.priceUsd)}${change ? `, ${change}` : ""}.`;
  }

  const extended = q.session === "pre" ? "pre-mercado" : q.session === "post" ? "post-mercado" : null;
  const regular = isPrice(q.regularPriceUsd) ? q.regularPriceUsd : null;

  if (regular !== null) {
    // En pre-mercado el cierre regular es del día hábil anterior; en post, del mismo día.
    const today = q.session !== "pre" && q.at !== null && nyDate(q.at) === nyDate(now);
    const day = prev !== null ? ` (${signedPct(gapBps(regular, prev))} en el día)` : "";
    let s = `${name} cerró ${today ? "hoy" : "su última sesión"} en ${dollars(regular)}${day}`;
    const vsClose = `${signedPct(gapBps(q.priceUsd, regular))} vs ese cierre`;
    if (extended) {
      s += `; en ${extended} está en ${dollars(q.priceUsd)} (${vsClose})`;
    } else if (q.session === "closed" && gapBps(q.priceUsd, regular) !== 0) {
      s += `; su último precio fuera de horario fue ${dollars(q.priceUsd)} (${vsClose})`;
    }
    return `${s}.`;
  }

  const change = vsPrev(q.priceUsd);
  const tail = change ? ` (${change})` : "";
  if (extended) return `En ${extended}, ${name} está en ${dollars(q.priceUsd)}${tail}.`;
  return `El último precio de ${name} en bolsa es ${dollars(q.priceUsd)}${tail}.`;
}

// ── b) Rango de 52 semanas ───────────────────────────────────────────────────

function rangeSentence(q: StockQuote | null, f: Fundamentals | null): string | null {
  if (!q || !f) return null;
  const { low52w: low, high52w: high } = f;
  if (!isPrice(low) || !isPrice(high) || high <= low) return null;
  // El rango de 52 semanas se arma con precios de la sesión regular.
  const price = q.session !== "regular" && isPrice(q.regularPriceUsd) ? q.regularPriceUsd : q.priceUsd;
  if (!isPrice(price)) return null;

  const toHigh = gapBps(price, high);
  if (toHigh > 0) return `Cotiza por encima del máximo de 52 semanas informado (${dollars(high)}).`;
  if (toHigh === 0) return `Está en su máximo de 52 semanas (${dollars(high)}).`;
  const toLow = gapBps(price, low);
  if (toLow < 0) return `Cotiza por debajo del mínimo de 52 semanas informado (${dollars(low)}).`;
  if (toLow === 0) return `Está en su mínimo de 52 semanas (${dollars(low)}).`;

  // Entre 1 y 99: "100%" junto a "a 0,10% de su máximo" se leería contradictorio.
  const position = Math.min(99, Math.max(1, Math.round(((price - low) / (high - low)) * 100)));
  return `Está en el ${position}% de su rango de 52 semanas, a ${pct(-toHigh)} de su máximo (${dollars(high)}).`;
}

// ── c) Tokens frente a la bolsa ──────────────────────────────────────────────

function tokensSentence(prices: PriceInfo[], session: MarketSession): string | null {
  const first = prices[0]!;
  const plural = prices.length > 1;
  const closedNote =
    session !== "open" ? "Con la bolsa cerrada, el precio onchain refleja lo que el mercado anticipa para la próxima apertura." : null;

  const gaps = prices.flatMap((p) =>
    isPrice(p.referenceUsd) && isPrice(p.onchainUsd) ? [{ p, bps: gapBps(p.onchainUsd, p.referenceUsd) }] : [],
  );

  if (!gaps.length) {
    const change = first.change24hPct;
    const move =
      typeof change === "number" && Number.isFinite(change)
        ? ` En 24 h, ${bold(first.token.symbol)} varió ${signedPct(change * 100)} onchain.`
        : "";
    const compare = `No hay precio de bolsa ahora para comparar ${plural ? "los tokens" : "el token"} con la acción.`;
    return [compare + move, closedNote].filter(Boolean).join(" ");
  }

  const maxAbs = Math.max(...gaps.map((g) => Math.abs(g.bps)));
  const level = maxAbs < IN_LINE_BPS ? "en línea con la bolsa" : maxAbs <= HIGH_GAP_BPS ? "brecha moderada" : "brecha alta";
  const parts: string[] = [];

  if (gaps.length === 1) {
    const { p, bps } = gaps[0]!;
    parts.push(`${bold(p.token.symbol)} cotiza ${direction(bps)} su valor en bolsa (${level}).`);
  } else {
    const list = listEs(gaps.map(({ p, bps }) => `${bold(p.token.symbol)} ${signedPct(bps)}`));
    parts.push(`Frente a la bolsa: ${list} (${level}).`);
    // Dato, no consejo: cuál cotiza más bajo frente a la bolsa. Con empate no hay un único "más bajo".
    const [lowest, next] = [...gaps].sort((a, b) => a.bps - b.bps);
    if (lowest && next && lowest.bps < next.bps) {
      parts.push(`Ahora el que cotiza más bajo frente a la bolsa es ${bold(lowest.p.token.symbol)} (${issuerName(lowest.p.token.issuer)}).`);
    }
  }

  if (closedNote) parts.push(closedNote);
  else if (maxAbs >= IN_LINE_BPS) parts.push("Con la bolsa abierta, la diferencia puede deberse a la liquidez onchain.");
  return parts.join(" ");
}

function direction(bps: number): string {
  if (bps === 0) return "a la par de";
  return `${pct(Math.abs(bps))} ${bps > 0 ? "por encima" : "por debajo"} de`;
}

// ── d) Multiplicador ─────────────────────────────────────────────────────────

function multiplierSentence(prices: PriceInfo[]): string | null {
  const adjusted = prices.filter((p) => isPrice(p.multiplier) && Math.abs(p.multiplier - 1) > MULTIPLIER_EPSILON);
  const [head, ...rest] = adjusted;
  if (!head) return null;
  const items = [
    `1 ${bold(head.token.symbol)} equivale a ${units(head.multiplier)} acciones`,
    ...rest.map((p) => `1 ${bold(p.token.symbol)} a ${units(p.multiplier)}`),
  ];
  const compared = adjusted.some((p) => isPrice(p.referenceUsd)) ? "; la brecha ya lo considera" : "";
  return `${listEs(items)} (dividendos reinvertidos o splits del emisor)${compared}.`;
}

// ── e) Operabilidad ──────────────────────────────────────────────────────────

function tradableSentence(prices: PriceInfo[]): string | null {
  const paused = prices.filter((p) => !p.tradable.ok);
  if (!paused.length) return null;
  const label = (p: PriceInfo) => `${bold(p.token.symbol)} (${issuerName(p.token.issuer)})`;
  const why = (p: PriceInfo) => (p.tradable.reason ? md(p.tradable.reason).replace(/[.;:,\s]+$/, "") : "") || "sin motivo informado";
  if (paused.length === 1) return `${label(paused[0]!)} no se puede operar ahora: ${why(paused[0]!)}.`;
  return `No se pueden operar ahora: ${paused.map((p) => `${label(p)} — ${why(p)}`).join("; ")}.`;
}

// ── f) Contexto ──────────────────────────────────────────────────────────────

function contextSentence(f: Fundamentals | null): string | null {
  if (!f) return null;
  const parts: string[] = [];
  if (isFiniteNumber(f.priceToEarnings)) parts.push(`P/E de ${num(f.priceToEarnings)}`);
  if (isFiniteNumber(f.dividendYieldPct) && f.dividendYieldPct >= 0) parts.push(`dividendo anual de ${pct(f.dividendYieldPct * 100)}`);
  return parts.length ? `Contexto: ${listEs(parts)}.` : null;
}

// ── Utilidades ───────────────────────────────────────────────────────────────

const isFiniteNumber = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

const isPrice = (n: number | null | undefined): n is number => isFiniteNumber(n) && n > 0;

const num = (n: number) => n.toLocaleString("es-BO", { maximumFractionDigits: 2 });

/** Quita los caracteres que rompen el Markdown legado de Telegram (textos que vienen de afuera). */
const md = (s: string) => s.replace(/[*_`[\]]/g, " ").replace(/\s+/g, " ").trim();

const bold = (s: string) => `*${md(s)}*`;

/** "a", "a y b", "a, b y c". */
function listEs(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/** Fecha calendario en Nueva York, "YYYY-MM-DD". */
function nyDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
