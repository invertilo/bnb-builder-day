/**
 * Configura el bot de Telegram en el deploy de Vercel con un solo comando:
 *   npm run telegram:setup                     (usa https://primera-accion.vercel.app)
 *   npm run telegram:setup -- https://otro-deploy.vercel.app
 *
 * 1. Lee TELEGRAM_BOT_TOKEN de tu .env y lo valida con Telegram.
 * 2. Genera TELEGRAM_WEBHOOK_SECRET y CRON_SECRET si faltan (los guarda en .env).
 * 3. Sube esas variables (y TELEGRAM_TRADER_IDS si existe) a Vercel como secretos de Production.
 * 4. Redespliega producción y conecta el webhook del bot.
 * Nunca imprime secretos. Es idempotente: puedes volver a correrlo (por ejemplo, después de agregar tu ID).
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { Bot } from "grammy";
import { BOT_COMMANDS } from "../telegram/bot.js";

const VERCEL = ["-y", "vercel@62.2.0"];
const SCOPE = ["--scope", process.env.VERCEL_SCOPE ?? "invertilos-projects"];
const url = (process.argv[2] ?? "https://primera-accion.vercel.app").replace(/\/$/, "");

if (!existsSync(".env")) fail("No hay .env. Créalo con: cp .env.example .env  y pega tu TELEGRAM_BOT_TOKEN.");
process.loadEnvFile();

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!token) fail("Falta TELEGRAM_BOT_TOKEN en .env (el token que te dio @BotFather).");

const bot = new Bot(token);
const me = await bot.api.getMe().catch(() => fail("Telegram rechazó el token: revisa TELEGRAM_BOT_TOKEN en .env."));
step(`Token válido: @${me.username}`);

const webhookSecret = ensureSecret("TELEGRAM_WEBHOOK_SECRET");
const cronSecret = ensureSecret("CRON_SECRET");

const vars: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: token,
  TELEGRAM_WEBHOOK_SECRET: webhookSecret,
  CRON_SECRET: cronSecret,
};
const traders = process.env.TELEGRAM_TRADER_IDS?.trim();
if (traders) vars.TELEGRAM_TRADER_IDS = traders;

for (const [name, value] of Object.entries(vars)) {
  vercel(["env", "rm", name, "production", "-y"], undefined, true); // si no existía, no pasa nada
  const added = vercel(["env", "add", name, "production", "--sensitive"], value);
  if (!added) fail(`No pude subir ${name} a Vercel. ¿Corriste "npx vercel login" y "npx vercel link"?`);
  step(`${name} cargada en Vercel (Production)`);
}

step("Redesplegando producción para que tome las variables… (1-2 min)");
if (!vercel(["redeploy", url.replace(/^https?:\/\//, ""), "--target", "production"])) {
  fail("El redeploy falló. Revisa el dashboard de Vercel.");
}

await bot.api.setWebhook(`${url}/api/telegram`, {
  secret_token: webhookSecret,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: true,
});
await bot.api.setMyCommands(BOT_COMMANDS);
const info = await bot.api.getWebhookInfo();
step(`Webhook conectado: ${info.url}`);

console.log(`
Listo. Abre https://t.me/${me.username} y escribe /start.
${traders ? `Pueden operar los IDs: ${traders}` : `Para poder operar: escríbele /id al bot, agrega TELEGRAM_TRADER_IDS=<tu id> en .env y vuelve a correr npm run telegram:setup`}
`);

function ensureSecret(name: string): string {
  const current = process.env[name]?.trim();
  if (current) return current;
  const value = randomBytes(32).toString("hex");
  const text = existsSync(".env") ? readFileSync(".env", "utf8") : "";
  appendFileSync(".env", `${text.endsWith("\n") || !text ? "" : "\n"}${name}=${value}\n`);
  step(`${name} generada y guardada en .env`);
  return value;
}

function vercel(args: string[], input?: string, quiet = false): boolean {
  const res = spawnSync("npx", [...VERCEL, ...args, ...SCOPE], {
    input,
    stdio: [input === undefined ? "inherit" : "pipe", quiet || input !== undefined ? "pipe" : "inherit", quiet ? "pipe" : "inherit"],
    encoding: "utf8",
  });
  return res.status === 0;
}

function step(msg: string): void {
  console.log(`✓ ${msg}`);
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
