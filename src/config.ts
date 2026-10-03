import { z } from "zod";
import type { Issuer } from "./domain/types.js";

const csvNumbers = z
  .string()
  .default("")
  .transform((s) => new Set(s.split(",").map((x) => x.trim()).filter(Boolean).map(Number)));

const ConfigSchema = z.object({
  TELEGRAM_BOT_TOKEN: z
    .string({ error: "Falta TELEGRAM_BOT_TOKEN (créalo con @BotFather)" })
    .min(1, "Falta TELEGRAM_BOT_TOKEN (créalo con @BotFather)"),
  TELEGRAM_TRADER_IDS: csvNumbers,

  // LLM compatible con OpenAI (AgentRouter por defecto).
  LLM_BASE_URL: z.string().url().default("https://agentrouter.org/v1"),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("deepseek-v4-flash"),

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
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // En .env las variables vacías ("CLAVE=") cuentan como no definidas.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = ConfigSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuración inválida en .env:\n${issues}`);
  }
  const cfg = parsed.data;
  if (Boolean(cfg.BINANCE_API_KEY) !== Boolean(cfg.BINANCE_API_SECRET)) {
    throw new Error("BINANCE_API_KEY y BINANCE_API_SECRET van juntas: completa las dos o ninguna.");
  }
  return cfg;
}
