import type { MarketSession } from "../domain/market-hours.js";
import { gapBps } from "../domain/policy.js";
import type { Issuer } from "../domain/types.js";
import type { PriceInfo } from "../ports.js";
import type { StockQuote } from "../stocks/quotes.js";

export const DISCLAIMER =
  "Primera Acción ejecuta lo que tú decides: no da recomendaciones de inversión. Invierte solo lo que puedas perder.";

export const HELP = `👋 *Hola, soy Primera Acción.*
Te ayudo a comprar acciones de empresas de EE.UU. tokenizadas en BNB Chain, pagando con USDT.

*Prueba escribiendo:*
• \`precio de apple\`
• \`compra 10 de nvidia\`
• \`vende todo mi tesla\`
• \`portafolio\`
• \`armame una canasta de chips: NVDA 40 AMD 30 TSM 30\`
• \`invierte 50 en mi canasta chips\`
• \`compra 20 de mi canasta chips cada 7 días\`
• \`¿qué es una acción tokenizada?\`

*Comandos:* /precio /analizar /comprar /vender /portafolio /canastas /historial /ayuda

Antes de cada operación te muestro el precio, el slippage y una simulación, y no hago nada hasta que confirmes.

_${DISCLAIMER}_`;

export const WHAT_IS_TOKENIZED = `*¿Qué es una acción tokenizada?*
Es un token en la blockchain que sigue el precio de una acción real (por ejemplo Apple). Lo emite una empresa (bStocks, Ondo o xStocks) que respalda el token con la acción o con un instrumento equivalente.

*Lo bueno:* puedes comprar con montos chicos en USDT, a cualquier hora, sin abrir una cuenta en un broker de EE.UU. (algunos emisores piden un mínimo por orden, por ejemplo 20 USD).

*Lo que tienes que saber:*
• Dependes del emisor que respalda el token.
• Fuera del horario de la bolsa de EE.UU. el precio onchain se puede separar del último cierre.
• Si hay poca liquidez, el precio que pagas puede empeorar con montos grandes (slippage).
• Los derechos (dividendos, votos) dependen de cada emisor.`;

export function sessionLabel(session: MarketSession): string {
  switch (session) {
    case "open":
      return "🟢 Bolsa de EE.UU. abierta";
    case "closed-weekend":
      return "🌙 Bolsa cerrada (fin de semana)";
    case "closed-holiday":
      return "🌙 Bolsa cerrada (feriado en EE.UU.)";
    case "closed-overnight":
      return "🌙 Bolsa cerrada (fuera de horario)";
  }
}

export const CLOSED_MARKET_WARNING =
  "La bolsa de EE.UU. está cerrada: el token sigue operando, pero su precio puede moverse distinto al de la acción hasta la próxima apertura.";

export const usd = (n: number) =>
  `${n.toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;

const pctNumber = (bps: number) =>
  (bps / 100).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const pct = (bps: number) => `${pctNumber(bps)}%`;

export const units = (n: number) => n.toLocaleString("es-BO", { maximumFractionDigits: 6 });

export const signedPct = (bps: number) => `${bps > 0 ? "+" : ""}${pctNumber(bps)}%`;

export const dollars = (n: number) =>
  `${n.toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;

export function issuerName(issuer: Issuer): string {
  return { ondo: "Ondo", bstocks: "bStocks", xstocks: "xStocks" }[issuer];
}

const SESSION_TAG: Record<StockQuote["session"], string> = {
  regular: "en vivo",
  pre: "pre-mercado",
  post: "post-mercado",
  closed: "último precio",
  unknown: "último precio",
};

/** "vie 2 oct, 16:00 (hora de Nueva York)" */
export function nyTime(d: Date): string {
  const s = new Intl.DateTimeFormat("es-BO", {
    timeZone: "America/New_York",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
  return `${s} (hora de Nueva York)`;
}

export function stockLine(q: StockQuote): string {
  const tag = SESSION_TAG[q.session];
  const when = q.at ? ` · ${nyTime(q.at)}` : "";
  const head = `🏛️ *En bolsa:* ${dollars(q.priceUsd)} — ${tag}${when} · fuente: ${q.source}`;
  if (q.session === "regular" && q.previousCloseUsd) {
    return `${head}\n   vs cierre anterior: ${signedPct(gapBps(q.priceUsd, q.previousCloseUsd))}`;
  }
  if (q.regularPriceUsd && q.previousCloseUsd) {
    const day = signedPct(gapBps(q.regularPriceUsd, q.previousCloseUsd));
    return `${head}\n   Cierre de la sesión regular: ${dollars(q.regularPriceUsd)} (${day} en el día)`;
  }
  return head;
}

/** Tarjeta de precio: acción en bolsa + cada token onchain con su brecha. */
export function priceCard(prices: PriceInfo[], now: Date): string {
  const first = prices[0]!;
  const stock = prices.find((p) => p.stock)?.stock ?? null;
  const title = `📈 *${first.token.name}* (${first.token.ticker})`;
  const tokens = prices.map((p) => {
    const gap = p.referenceUsd ? ` · ${signedPct(gapBps(p.onchainUsd, p.referenceUsd))} vs bolsa` : "";
    const mult = Math.abs(p.multiplier - 1) > 0.0005 ? ` · 1 token = ${units(p.multiplier)} acciones` : "";
    const status = p.tradable.ok ? "" : `\n   ⏸️ No operable: ${p.tradable.reason}`;
    return `• *${p.token.symbol}* (${issuerName(p.token.issuer)}): ${usd(p.onchainUsd)}${gap}${mult}${status}`;
  });
  return [
    title,
    stock ? stockLine(stock) : "🏛️ _Sin precio de bolsa disponible ahora._",
    "",
    "🪙 *Tokens en BNB Chain:*",
    ...tokens,
    "",
    sessionLabel(first.session),
  ].join("\n");
}

export function fundamentalsBlock(p: PriceInfo): string | null {
  const f = p.fundamentals;
  if (!f) return null;
  const rows: string[] = [];
  if (f.low52w !== null && f.high52w !== null) rows.push(`• Rango 52 semanas: ${dollars(f.low52w)} – ${dollars(f.high52w)}`);
  if (f.marketCapUsd !== null) rows.push(`• Capitalización: ${(f.marketCapUsd / 1e9).toLocaleString("es-BO", { maximumFractionDigits: 0 })} mil millones USD`);
  const num = (n: number) => n.toLocaleString("es-BO", { maximumFractionDigits: 2 });
  if (f.priceToEarnings !== null) rows.push(`• P/E: ${num(f.priceToEarnings)}`);
  if (f.dividendYieldPct !== null) rows.push(`• Dividendo anual: ${num(f.dividendYieldPct)}%`);
  return rows.length ? `📊 *Datos de la empresa*\n${rows.join("\n")}` : null;
}
