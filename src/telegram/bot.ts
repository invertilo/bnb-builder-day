import { Bot, GrammyError, InlineKeyboard, type Context } from "grammy";
import type { PrimeraAccion, Reply } from "../agent/service.js";
import { configStatus, configStep, TRY_PROMPTS, welcome, type BotStatus, type Screen } from "./onboarding.js";

export interface BotOptions {
  token: string;
  /** IDs de Telegram que pueden operar con la wallet del agente. El resto solo consulta precios y pregunta. */
  traders: Set<number>;
  /** Estado de la configuración (sin secretos) para el onboarding y /config. */
  status: BotStatus;
}

export function createBot(agent: PrimeraAccion, opts: BotOptions): Bot {
  // fetch nativo (no node-fetch + https.Agent): en el runtime Bun de Vercel las llamadas por node:https se colgaban.
  // Y un límite de 20 s por llamada a Telegram (por defecto grammY espera hasta 500 s).
  const bot = new Bot(opts.token, {
    client: { fetch: globalThis.fetch as never, baseFetchConfig: {}, timeoutSeconds: 20 },
  });

  bot.catch((err) => console.error("[telegram]", err.error));

  const canTrade = (id: number | undefined) => id !== undefined && opts.traders.has(id);

  // /start: bienvenida con los primeros pasos y botones para probar sin escribir.
  bot.command(["start", "ayuda", "help"], async (ctx) => {
    await sendScreen(ctx, welcome(ctx.from?.first_name, canTrade(ctx.from?.id), opts.status));
  });

  // /config: checklist de configuración y guía paso a paso.
  bot.command(["config", "configurar"], async (ctx) => {
    await sendScreen(ctx, configStatus(ctx.from!.id, canTrade(ctx.from?.id), opts.status));
  });

  // Botones del onboarding que ejecutan un ejemplo ("Ver un precio", "Analizar una acción"…).
  bot.callbackQuery(/^go:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const prompt = TRY_PROMPTS[ctx.match[1]!];
    if (!prompt) return;
    await ctx.replyWithChatAction("typing");
    try {
      await send(ctx, await agent.handle(ctx.from.id, prompt, canTrade(ctx.from.id)));
    } catch (err) {
      console.error("[agent]", err);
      await send(ctx, { text: `😵 Algo falló: ${(err as Error).message}` });
    }
  });

  // Navegación de la configuración: edita el mismo mensaje para que se sienta como una app.
  bot.callbackQuery(/^cfg:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const step = ctx.match[1]!;
    const userId = ctx.from.id;
    const screen =
      step === "status"
        ? configStatus(userId, canTrade(userId), opts.status)
        : step === "inicio"
          ? welcome(ctx.from.first_name, canTrade(userId), opts.status)
          : configStep(step, userId, canTrade(userId), opts.status);
    if (screen) await editScreen(ctx, screen);
  });

  // /id: muestra el ID de Telegram para agregarlo a TELEGRAM_TRADER_IDS.
  bot.command("id", async (ctx) => {
    const id = ctx.from?.id;
    const allowed = id !== undefined && opts.traders.has(id);
    await send(ctx, {
      text: `Tu ID de Telegram es \`${id}\`.\n${allowed ? "✅ Puedes operar con la wallet del agente." : "Para operar, agrégalo a TELEGRAM_TRADER_IDS."}`,
    });
  });

  bot.on("message:text", async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    await ctx.replyWithChatAction("typing");

    try {
      const reply = await agent.handle(userId, text, opts.traders.has(userId));
      // Si quiso operar sin estar autorizado, le ofrecemos la guía de configuración.
      if (reply.text.startsWith("🔒")) {
        await sendScreen(ctx, { text: reply.text, keyboard: new InlineKeyboard().text("⚙️ Ver cómo configurarlo", "cfg:status") });
      } else {
        await send(ctx, reply);
      }
    } catch (err) {
      console.error("[agent]", err);
      await send(ctx, { text: `😵 Algo falló: ${(err as Error).message}` });
    }
  });

  bot.callbackQuery(/^(ok|no):(.+)$/, async (ctx) => {
    const [, action, id] = ctx.match;
    const userId = ctx.from.id;
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

    if (action === "no") return send(ctx, await agent.cancel(userId, id!));
    if (!opts.traders.has(userId)) return;

    await send(ctx, { text: "⏳ Enviando transacción…" });
    try {
      await send(ctx, await agent.confirm(userId, id!));
    } catch (err) {
      console.error("[agent]", err);
      await send(ctx, { text: `❌ No se pudo ejecutar: ${(err as Error).message}` });
    }
  });

  return bot;
}

async function send(ctx: Context, reply: Reply): Promise<void> {
  const reply_markup = reply.confirmId
    ? new InlineKeyboard().text("✅ Confirmar", `ok:${reply.confirmId}`).text("✖️ Cancelar", `no:${reply.confirmId}`)
    : undefined;
  try {
    await ctx.reply(reply.text, { parse_mode: "Markdown", reply_markup, link_preview_options: { is_disabled: true } });
  } catch (err) {
    // Si el Markdown viene roto (por ejemplo un "_" suelto), mandamos el texto plano.
    if (err instanceof GrammyError && err.description.includes("parse entities")) {
      await ctx.reply(reply.text, { reply_markup });
    } else {
      throw err;
    }
  }
}

async function sendScreen(ctx: Context, screen: Screen): Promise<void> {
  try {
    await ctx.reply(screen.text, { parse_mode: "Markdown", reply_markup: screen.keyboard, link_preview_options: { is_disabled: true } });
  } catch (err) {
    if (err instanceof GrammyError && err.description.includes("parse entities")) {
      await ctx.reply(screen.text, { reply_markup: screen.keyboard });
    } else {
      throw err;
    }
  }
}

async function editScreen(ctx: Context, screen: Screen): Promise<void> {
  try {
    await ctx.editMessageText(screen.text, { parse_mode: "Markdown", reply_markup: screen.keyboard, link_preview_options: { is_disabled: true } });
  } catch (err) {
    // "message is not modified" (tocó Revisar sin cambios) no es un error; si no se puede editar, mandamos uno nuevo.
    if (err instanceof GrammyError && err.description.includes("not modified")) return;
    await sendScreen(ctx, screen);
  }
}

/** Comandos que muestra Telegram en el menú del bot. */
export const BOT_COMMANDS = [
  { command: "start", description: "Empezar: guía rápida y ejemplos" },
  { command: "config", description: "Configurar el bot paso a paso" },
  { command: "precio", description: "Precio en bolsa y de los tokens. Ej: /precio apple" },
  { command: "analizar", description: "Análisis con IA de una acción. Ej: /analizar nvidia" },
  { command: "comprar", description: "Comprar con USDT. Ej: /comprar 25 tesla" },
  { command: "vender", description: "Vender. Ej: /vender todo apple" },
  { command: "portafolio", description: "Tus acciones y saldo" },
  { command: "canastas", description: "Tus canastas y plantillas" },
  { command: "historial", description: "Últimas operaciones" },
  { command: "id", description: "Tu ID de Telegram (para autorizarte a operar)" },
  { command: "ayuda", description: "Qué puedo hacer" },
];

/** Manda las propuestas de compras programadas (DCA) que vencieron. Devuelve cuántas envió. */
export async function sendDcaProposals(bot: Bot, agent: PrimeraAccion): Promise<number> {
  let sent = 0;
  for (const { userId, reply } of await agent.dueDcaProposals()) {
    const reply_markup = reply.confirmId
      ? new InlineKeyboard().text("✅ Confirmar", `ok:${reply.confirmId}`).text("✖️ Cancelar", `no:${reply.confirmId}`)
      : undefined;
    try {
      await bot.api.sendMessage(userId, reply.text, { parse_mode: "Markdown", reply_markup });
      sent++;
    } catch (e) {
      console.error("[dca]", e);
    }
  }
  return sent;
}

/** Modo proceso largo (npm run dev / Docker): revisa el DCA cada 5 minutos. En Vercel lo hace un cron. */
export function startDcaScheduler(bot: Bot, agent: PrimeraAccion, everyMs = 5 * 60_000): NodeJS.Timeout {
  return setInterval(() => {
    sendDcaProposals(bot, agent).catch((err) => console.error("[dca]", err));
  }, everyMs);
}
