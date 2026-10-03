/**
 * Horario de la bolsa de EE.UU. (NYSE/Nasdaq). Es el respaldo cuando la API de mercado no responde.
 * Las acciones tokenizadas operan 24/7 onchain, pero con la bolsa cerrada el precio puede
 * separarse del último cierre: por eso avisamos al usuario antes de comprar.
 */

// Feriados NYSE (fecha en Nueva York). Fuente: calendario oficial NYSE.
const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

// Días con cierre anticipado a las 13:00 ET.
const EARLY_CLOSE = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]);

export type MarketSession = "open" | "closed-weekend" | "closed-holiday" | "closed-overnight";

interface NyClock {
  date: string; // YYYY-MM-DD
  weekday: number; // 0 = domingo
  minutes: number; // minutos desde medianoche
}

function nyClock(now: Date): NyClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: weekdays.indexOf(get("weekday")),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export function usMarketSession(now: Date = new Date()): MarketSession {
  const { date, weekday, minutes } = nyClock(now);
  if (weekday === 0 || weekday === 6) return "closed-weekend";
  if (HOLIDAYS.has(date)) return "closed-holiday";
  const open = 9 * 60 + 30;
  const close = EARLY_CLOSE.has(date) ? 13 * 60 : 16 * 60;
  return minutes >= open && minutes < close ? "open" : "closed-overnight";
}
