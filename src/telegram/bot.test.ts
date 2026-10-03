import { describe, expect, it } from "vitest";
import type { PrimeraAccion } from "../agent/service.js";
import { createBot } from "./bot.js";
import { configStatus, configStep, welcome, type BotStatus } from "./onboarding.js";

const status: BotStatus = {
  ai: "deepseek/deepseek-v4-flash",
  binance: false,
  wallet: null,
  limits: { maxTradeUsd: 50, maxDailyUsd: 100, maxSlippageBps: 100 },
  webUrl: "https://primera-accion.vercel.app",
};

/** Markdown "legacy" de Telegram: fuera de `código`, los * y _ tienen que cerrar. */
function legacyMarkdownOk(text: string): boolean {
  const outside = text.split("`").filter((_, i) => i % 2 === 0).join("");
  const count = (c: string) => [...outside].filter((x) => x === c).length;
  return text.split("`").length % 2 === 1 && count("*") % 2 === 0 && count("_") % 2 === 0;
}

type Call = { method: string; payload: Record<string, unknown> };

function makeBot(traders: number[] = [], handle = async (_id: number, text: string) => ({ text: `respuesta a ${text}` })) {
  const agent = { handle, cancel: async () => ({ text: "x" }), confirm: async () => ({ text: "x" }) } as unknown as PrimeraAccion;
  const bot = createBot(agent, { token: "1:test", traders: new Set(traders), status });
  bot.botInfo = {
    id: 1, is_bot: true, first_name: "Primera Acción", username: "TuPrimeraAccionBot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
    can_connect_to_business: false, has_main_web_app: false,
  } as typeof bot.botInfo;
  const calls: Call[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const result = method === "sendMessage" ? { message_id: 1, date: 0, chat: { id: 5, type: "private" } } : true;
    return { ok: true, result } as never;
  });
  return { bot, calls };
}

const message = (text: string, id = 5) => ({
  update_id: Math.floor(Math.random() * 1e6),
  message: {
    message_id: 1, date: 0, text,
    chat: { id, type: "private" as const, first_name: "Ana" },
    from: { id, is_bot: false, first_name: "Ana" },
    entities: text.startsWith("/") ? [{ type: "bot_command" as const, offset: 0, length: text.split(" ")[0]!.length }] : undefined,
  },
});

const callback = (data: string, id = 5) => ({
  update_id: Math.floor(Math.random() * 1e6),
  callback_query: {
    id: "cb", chat_instance: "x", data,
    from: { id, is_bot: false, first_name: "Ana" },
    message: { message_id: 9, date: 0, chat: { id, type: "private" as const }, text: "anterior" },
  },
});

describe("onboarding", () => {
  it("los textos usan Markdown válido para Telegram", () => {
    const screens = [
      welcome("Ana", false, status),
      configStatus(5, false, status),
      configStatus(5, true, { ...status, binance: true, wallet: "0x00000000000000000000000000000000000000aa" }),
      ...["autorizar", "binance", "wallet", "limites"].map((s) => configStep(s, 5, false, status)!),
    ];
    for (const s of screens) expect(legacyMarkdownOk(s.text), s.text).toBe(true);
  });

  it("el checklist marca lo que falta y sugiere el siguiente paso", () => {
    const s = configStatus(5, false, status);
    expect(s.text).toContain("Modo consulta");
    expect(s.text).toContain("Siguiente paso");
    expect(s.text).toContain("Autorizarme");
    const ready = configStatus(5, true, { ...status, binance: true, wallet: "0x00000000000000000000000000000000000000aa" });
    expect(ready.text).toContain("Listo para operar");
    expect(ready.text).not.toContain("Siguiente paso");
  });

  it("la guía de autorización incluye el ID del usuario", () => {
    expect(configStep("autorizar", 777, false, status)!.text).toContain("TELEGRAM_TRADER_IDS=777");
  });
});

describe("bot de Telegram", () => {
  it("/start responde con la guía y botones", async () => {
    const { bot, calls } = makeBot();
    await bot.handleUpdate(message("/start"));
    const sent = calls.find((c) => c.method === "sendMessage")!;
    expect(sent.payload.text).toContain("Hola, Ana");
    expect(JSON.stringify(sent.payload.reply_markup)).toContain("go:precio");
    expect(JSON.stringify(sent.payload.reply_markup)).toContain("cfg:status");
  });

  it("/config muestra el checklist", async () => {
    const { bot, calls } = makeBot();
    await bot.handleUpdate(message("/config"));
    expect(calls.find((c) => c.method === "sendMessage")!.payload.text).toContain("Configuración de tu agente");
  });

  it("el botón 'Ver un precio' le pregunta al agente", async () => {
    const { bot, calls } = makeBot();
    await bot.handleUpdate(callback("go:precio"));
    expect(calls.find((c) => c.method === "sendMessage")!.payload.text).toBe("respuesta a precio de apple");
  });

  it("los botones de configuración editan el mismo mensaje", async () => {
    const { bot, calls } = makeBot();
    await bot.handleUpdate(callback("cfg:binance"));
    const edit = calls.find((c) => c.method === "editMessageText")!;
    expect(edit.payload.text).toContain("Conectar la API de Binance");
  });

  it("si alguien sin autorización intenta operar, le ofrece la guía", async () => {
    const { bot, calls } = makeBot([], async () => ({ text: "🔒 Este agente opera con una wallet privada." }));
    await bot.handleUpdate(message("compra 25 de apple"));
    const sent = calls.find((c) => c.method === "sendMessage")!;
    expect(JSON.stringify(sent.payload.reply_markup)).toContain("cfg:status");
  });

  it("los mensajes normales pasan al agente", async () => {
    const { bot, calls } = makeBot();
    await bot.handleUpdate(message("precio de tesla"));
    expect(calls.find((c) => c.method === "sendMessage")!.payload.text).toBe("respuesta a precio de tesla");
  });
});
