/**
 * Configura el bot de Telegram en el deploy de Vercel con un solo comando:
 *   npm run telegram:setup                     (usa https://primera-accion.vercel.app)
 *   npm run telegram:setup -- https://otro-deploy.vercel.app
 *
 * 1. Lee TELEGRAM_BOT_TOKEN de tu .env (si falta, te lo pide con la entrada oculta y lo guarda) y lo valida con Telegram.
 * 2. Genera TELEGRAM_WEBHOOK_SECRET y CRON_SECRET si faltan (los guarda en .env).
 * 3. Sube esas variables a Vercel como secretos de Production, más las opcionales que haya en .env
 *    (TELEGRAM_TRADER_IDS, BINANCE_API_KEY/SECRET, AGENT_PRIVATE_KEY, LLM_API_KEY, MAX_*).
 * 4. Redespliega producción y conecta el webhook del bot.
 * Nunca imprime secretos. Es idempotente: puedes volver a correrlo (por ejemplo, después de agregar tu ID).
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { Bot } from "grammy";
import { BOT_COMMANDS } from "../telegram/bot.js";

const VERCEL = ["-y", "vercel@62.2.0"];
const SCOPE = ["--scope", process.env.VERCEL_SCOPE ?? "invertilos-projects"];
const url = (process.argv[2] ?? "https://primera-accion.vercel.app").replace(/\/$/, "");

if (!existsSync(".env")) fail("No hay .env. Créalo con: cp .env.example .env  y pega tu TELEGRAM_BOT_TOKEN.");
process.loadEnvFile();

let token = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!token) {
  if (!process.stdin.isTTY) {
    fail("Falta TELEGRAM_BOT_TOKEN en .env. Corre este comando en una terminal para pegarlo, o escríbelo en .env y guarda el archivo.");
  }
  token = await askHidden("Pega el token de @BotFather (no se muestra) y presiona Enter: ");
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) fail("Eso no parece un token de bot (formato 123456:ABC…).");
  saveToEnv("TELEGRAM_BOT_TOKEN", token);
  step("Token guardado en .env");
}

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
// Lo que el bot guía a configurar desde /config: si está en .env, se sube también.
for (const name of ["BINANCE_API_KEY", "BINANCE_API_SECRET", "AGENT_PRIVATE_KEY", "LLM_API_KEY", "MAX_TRADE_USD", "MAX_DAILY_USD", "MAX_SLIPPAGE_BPS"]) {
  const value = process.env[name]?.trim();
  if (value) vars[name] = value;
}

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

/** Lee una línea sin mostrarla en pantalla (para pegar el token). */
function askHidden(question: string): Promise<string> {
  process.stdout.write(question);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  let value = "";
  return new Promise((resolve) => {
    const onData = (chunk: string) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n" || c === "\u0004") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value.trim());
          return;
        }
        if (c === "\u0003") {
          process.stdout.write("\n");
          process.exit(130);
        }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on("data", onData);
  });
}

/** Escribe NAME=valor en .env (reemplaza la línea si existe). */
function saveToEnv(name: string, value: string): void {
  const text = existsSync(".env") ? readFileSync(".env", "utf8") : "";
  const line = new RegExp(`^${name}=.*$`, "m");
  const next = line.test(text) ? text.replace(line, `${name}=${value}`) : `${text.replace(/\n?$/, "\n")}${name}=${value}\n`;
  writeFileSync(".env", next, { mode: 0o600 });
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
