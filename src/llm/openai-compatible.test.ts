import { describe, expect, it } from "vitest";
import { OpenAiCompatibleLlm, parseJsonLoose, textOf } from "./openai-compatible.js";

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("parseJsonLoose", () => {
  it("acepta JSON en bloque de código o con texto alrededor", () => {
    expect(parseJsonLoose('```json\n{"kind":"help"}\n```')).toEqual({ kind: "help" });
    expect(parseJsonLoose('Claro: {"kind":"portfolio"} listo')).toEqual({ kind: "portfolio" });
  });
});

describe("textOf", () => {
  it("acepta texto o lista de partes", () => {
    expect(textOf("  hola ")).toBe("hola");
    expect(textOf([{ type: "text", text: "ho" }, { type: "text", text: "la" }])).toBe("hola");
    expect(textOf(null)).toBe("");
  });
});

describe("OpenAiCompatibleLlm", () => {
  it("una página HTML del firewall del proveedor se informa como bloqueo", async () => {
    const llm = new OpenAiCompatibleLlm(
      { baseUrl: "https://x/v1", apiKey: "k", model: "m" },
      (async () => new Response('<!doctype html><meta name="aliyun_waf_aa" content="x">', { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })) as unknown as typeof fetch,
    );
    await expect(llm.text("s", "hola")).rejects.toThrow("bloqueó la llamada");
  });

  it("respuesta vacía informa el finish_reason", async () => {
    const llm = new OpenAiCompatibleLlm(
      { baseUrl: "https://x/v1", apiKey: "k", model: "m" },
      (async () => reply(200, { choices: [{ message: { content: "" }, finish_reason: "length" }] })) as unknown as typeof fetch,
    );
    await expect(llm.text("s", "hola")).rejects.toThrow("finish_reason: length");
  });

  it("llama a /chat/completions con el modelo y el token", async () => {
    const calls: { url: string; body: Record<string, unknown>; auth: string }[] = [];
    const llm = new OpenAiCompatibleLlm(
      { baseUrl: "https://openrouter.ai/api/v1/", apiKey: "test-key", model: "deepseek/deepseek-v4-flash" },
      (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(init.body as string), auth: (init.headers as Record<string, string>).Authorization! });
        return reply(200, { choices: [{ message: { content: '{"kind":"buy","ticker":"NVDA","usd":25}' } }] });
      }) as unknown as typeof fetch,
    );
    expect(await llm.json("sistema", "compra 25 de nvidia")).toEqual({ kind: "buy", ticker: "NVDA", usd: 25 });
    expect(calls[0]!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0]!.body.model).toBe("deepseek/deepseek-v4-flash");
    expect(calls[0]!.auth).toBe("Bearer test-key");
  });

  it("si el proveedor rechaza response_format, reintenta sin él", async () => {
    const bodies: Record<string, unknown>[] = [];
    const llm = new OpenAiCompatibleLlm(
      { baseUrl: "https://x/v1", apiKey: "k", model: "m" },
      (async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        bodies.push(body);
        return body.response_format ? reply(400, { error: { message: "unsupported" } }) : reply(200, { choices: [{ message: { content: '{"kind":"help"}' } }] });
      }) as unknown as typeof fetch,
    );
    expect(await llm.json("s", "hola")).toEqual({ kind: "help" });
    expect(bodies).toHaveLength(2);
  });

  it("un 503 sugiere revisar el nombre del modelo", async () => {
    const llm = new OpenAiCompatibleLlm(
      { baseUrl: "https://x/v1", apiKey: "k", model: "modelo-mal-escrito" },
      (async () => reply(503, { error: { message: "no available channel" } })) as unknown as typeof fetch,
    );
    await expect(llm.text("s", "hola")).rejects.toThrow("nombre del modelo");
  });
});
