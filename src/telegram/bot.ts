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

    if (action === "no") return send(ctx, agent.cancel(userId, id!));
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

/** Revisa cada 5 minutos si hay compras programadas (DCA) y manda la propuesta para confirmar. */
export function startDcaScheduler(bot: Bot, agent: PrimeraAccion, everyMs = 5 * 60_000): NodeJS.Timeout {
  const tick = async () => {
    try {
      for (const { userId, reply } of await agent.dueDcaProposals()) {
        const reply_markup = reply.confirmId
          ? new InlineKeyboard().text("✅ Confirmar", `ok:${reply.confirmId}`).text("✖️ Cancelar", `no:${reply.confirmId}`)
          : undefined;
        await bot.api.sendMessage(userId, reply.text, { parse_mode: "Markdown", reply_markup }).catch((e) => console.error("[dca]", e));
      }
    } catch (err) {
      console.error("[dca]", err);
    }
  };
  return setInterval(tick, everyMs);
}
