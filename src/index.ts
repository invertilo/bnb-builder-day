import { GrammyError } from "grammy";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { BOT_COMMANDS, createBot, startDcaScheduler } from "./telegram/bot.js";

try {
  process.loadEnvFile();
} catch {
  // Sin .env: se usan las variables de entorno del sistema.
}

let cfg: ReturnType<typeof loadConfig>;
try {
  cfg = loadConfig();
} catch (err) {
  console.error(`${(err as Error).message}\n\nCopia .env.example a .env y complétalo.`);
  process.exit(1);
}
const app = buildApp(cfg);
const bot = createBot(app.agent, { token: cfg.TELEGRAM_BOT_TOKEN!, traders: cfg.TELEGRAM_TRADER_IDS });

try {
  await bot.init();
} catch (err) {
  const unauthorized = err instanceof GrammyError && err.error_code === 401;
  console.error(unauthorized ? "TELEGRAM_BOT_TOKEN no es válido: cópialo de nuevo desde @BotFather." : `No pude conectar con Telegram: ${(err as Error).message}`);
  process.exit(1);
}

await bot.api.setMyCommands(BOT_COMMANDS);

const timer = startDcaScheduler(bot, app.agent);

console.log(
  [
    "Primera Acción",
    `  IA: ${app.llm ? `${cfg.LLM_MODEL} vía ${cfg.LLM_BASE_URL}` : "desactivada (falta LLM_API_KEY): solo reglas"}`,
    `  Precio de bolsa: ${cfg.STOCK_PRICE_SOURCE === "yahoo" ? "Yahoo Finance (respaldo: Binance)" : "Binance"}`,
    `  Emisores: ${cfg.ISSUERS.join(", ")}`,
    `  Trading: ${app.tradingEnabled ? `activo · wallet ${app.walletAddress}` : "solo lectura"}`,
    `  Operadores autorizados: ${cfg.TELEGRAM_TRADER_IDS.size ? [...cfg.TELEGRAM_TRADER_IDS].join(", ") : "ninguno (escríbele al bot para ver tu ID)"}`,
  ].join("\n"),
);

const stop = () => {
  clearInterval(timer);
  void bot.stop();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

await bot.start({ onStart: (me) => console.log(`Bot @${me.username} escuchando en Telegram`) });
