/**
 * Conecta el bot de Telegram al deploy de Vercel.
 * Uso: npm run webhook:set -- https://tu-proyecto.vercel.app
 *      npm run webhook:set -- --delete      (vuelve a modo polling para npm run dev)
 * Lee TELEGRAM_BOT_TOKEN y TELEGRAM_WEBHOOK_SECRET de .env. No imprime secretos.
 */
import { Bot } from "grammy";
import { BOT_COMMANDS } from "../telegram/bot.js";

try {
  process.loadEnvFile();
} catch {
  /* sin .env */
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const arg = process.argv[2];
if (!token) throw new Error("Falta TELEGRAM_BOT_TOKEN en .env");

const bot = new Bot(token);

if (arg === "--delete") {
  await bot.api.deleteWebhook();
  console.log("Webhook borrado: el bot vuelve a funcionar con npm run dev (polling).");
  process.exit(0);
}

if (!arg?.startsWith("https://")) throw new Error("Pasa la URL del deploy: npm run webhook:set -- https://tu-proyecto.vercel.app");
if (!secret) throw new Error("Falta TELEGRAM_WEBHOOK_SECRET en .env (el mismo valor que en Vercel). Genera uno con: openssl rand -hex 32");

const url = `${arg.replace(/\/$/, "")}/api/telegram`;
await bot.api.setWebhook(url, {
  secret_token: secret,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: true,
});
await bot.api.setMyCommands(BOT_COMMANDS);

const info = await bot.api.getWebhookInfo();
const me = await bot.api.getMe();
console.log(`@${me.username} → ${info.url}`);
console.log(`Pendientes: ${info.pending_update_count}${info.last_error_message ? ` · último error: ${info.last_error_message}` : ""}`);
