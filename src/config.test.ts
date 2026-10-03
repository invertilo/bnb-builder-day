import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const example = parseEnv(readFileSync(new URL("../.env.example", import.meta.url), "utf8")) as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it(".env.example + token de Telegram = configuración válida en modo solo lectura", () => {
    const cfg = loadConfig({ ...example, TELEGRAM_BOT_TOKEN: "123:abc" });
    expect(cfg.LLM_MODEL).toBe("deepseek-v4-flash");
    expect(cfg.LLM_BASE_URL).toBe("https://agentrouter.org/v1");
    expect(cfg.ISSUERS).toEqual(["ondo", "bstocks"]);
    expect(cfg.AGENT_PRIVATE_KEY).toBeUndefined();
    expect(cfg.LLM_API_KEY).toBeUndefined();
  });

  it("lee los IDs de Telegram autorizados", () => {
    const cfg = loadConfig({ ...example, TELEGRAM_BOT_TOKEN: "x", TELEGRAM_TRADER_IDS: "111, 222" });
    expect([...cfg.TELEGRAM_TRADER_IDS]).toEqual([111, 222]);
  });

  it("explica qué falta o qué está mal", () => {
    expect(() => loadConfig({ ...example })).toThrow("Falta TELEGRAM_BOT_TOKEN");
    expect(() => loadConfig({ ...example, TELEGRAM_BOT_TOKEN: "x", AGENT_PRIVATE_KEY: "0x123" })).toThrow("64 caracteres");
    expect(() => loadConfig({ ...example, TELEGRAM_BOT_TOKEN: "x", BINANCE_API_KEY: "k" })).toThrow("van juntas");
  });
});
