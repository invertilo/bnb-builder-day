import { z } from "zod/v4";
import type { Issuer } from "./domain/types.js";

const csvNumbers = z
  .string()
  .default("")
  .transform((s) => new Set(s.split(",").map((x) => x.trim()).filter(Boolean).map(Number)));

const ConfigSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_TRADER_IDS: csvNumbers,
  // Vercel: Telegram manda este valor en X-Telegram-Bot-Api-Secret-Token y así sabemos que el webhook es legítimo.
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,256}$/, "TELEGRAM_WEBHOOK_SECRET: 16 a 256 caracteres (letras, números, _ o -)")
    .optional(),
  // Vercel Cron manda "Authorization: Bearer <CRON_SECRET>".
  CRON_SECRET: z.string().min(16, "CRON_SECRET debe tener al menos 16 caracteres").optional(),

  // LLM compatible con OpenAI (OpenRouter por defecto: permite uso desde servidores).
  LLM_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("deepseek/deepseek-v4-flash"),
  // OpenRouter muestra la app con estos datos (encabezados HTTP-Referer y X-Title).
  LLM_APP_URL: z.string().url().default("https://primera-accion.vercel.app"),

  // Binance Web3 API (Trading / Market / Wallet / Transaction). Sin clave el bot funciona en modo solo lectura.
  BINANCE_API_KEY: z.string().optional(),
  BINANCE_API_SECRET: z.string().optional(),

  // Wallet del agente. Usa una wallet nueva y con montos chicos.
  AGENT_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "AGENT_PRIVATE_KEY debe ser 0x + 64 caracteres hex")
    .optional(),
  BSC_RPC_URL: z.string().url().default("https://bsc-dataseed.bnbchain.org"),

  ISSUERS: z
    .string()
    .default("ondo,bstocks")
    .transform((s) => s.split(",").map((x) => x.trim()) as Issuer[]),
  STOCK_PRICE_SOURCE: z.enum(["yahoo", "binance"]).default("yahoo"),

  MAX_TRADE_USD: z.coerce.number().positive().default(50),
  MAX_DAILY_USD: z.coerce.number().positive().default(100),
  MAX_SLIPPAGE_BPS: z.coerce.number().int().positive().default(100),
  MAX_REFERENCE_GAP_BPS: z.coerce.number().int().positive().default(150),
  MIN_TRADE_USD: z.coerce.number().positive().default(1),

  DATA_PATH: z.string().default("data/state.json"),

  // Límites del endpoint público /api/analyze (cada análisis usa el LLM).
  ANALYZE_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
  ANALYZE_DAILY_LIMIT: z.coerce.number().int().positive().default(500),
});

export type Config = z.infer<typeof ConfigSchema>;

export interface LoadOptions {
  /** El bot en modo polling necesita el token; la API web y Agent Studio no. */
  requireTelegram?: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, opts: LoadOptions = {}): Config {
  // En .env las variables vacías ("CLAVE=") cuentan como no definidas.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = ConfigSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuración inválida en .env:\n${issues}`);
  }
  const cfg = parsed.data;
  if ((opts.requireTelegram ?? true) && !cfg.TELEGRAM_BOT_TOKEN) {
    throw new Error("Configuración inválida en .env:\n  • TELEGRAM_BOT_TOKEN: Falta TELEGRAM_BOT_TOKEN (créalo con @BotFather)");
  }
  if (Boolean(cfg.BINANCE_API_KEY) !== Boolean(cfg.BINANCE_API_SECRET)) {
    throw new Error("BINANCE_API_KEY y BINANCE_API_SECRET van juntas: completa las dos o ninguna.");
  }
  return cfg;
}
