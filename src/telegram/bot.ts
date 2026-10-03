import { Bot, GrammyError, InlineKeyboard, type Context } from "grammy";
import type { PrimeraAccion, Reply } from "../agent/service.js";

export interface BotOptions {
  token: string;
  /** IDs de Telegram que pueden operar con la wallet del agente. El resto solo consulta precios y pregunta. */
  traders: Set<number>;
}

export function createBot(agent: PrimeraAccion, opts: BotOptions): Bot {
  const bot = new Bot(opts.token);

  bot.catch((err) => console.error("[telegram]", err.error));

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
      await send(ctx, await agent.handle(userId, text, opts.traders.has(userId)));
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

/** Comandos que muestra Telegram en el menú del bot. */
export const BOT_COMMANDS = [
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
