import type { FetchLike } from "../binance/public.js";
import type { Llm } from "../ports.js";

export interface LlmOptions {
  /** Ej. https://agentrouter.org/v1 (los modelos no Claude de AgentRouter usan el formato OpenAI con /v1). */
  baseUrl: string;
  apiKey: string;
  /** Debe coincidir exactamente con la página de precios del proveedor, ej. "deepseek-v4-flash". */
  model: string;
  timeoutMs?: number;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

/** Cliente mínimo de Chat Completions compatible con OpenAI. */
export class OpenAiCompatibleLlm implements Llm {
  constructor(
    private readonly opts: LlmOptions,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async text(instructions: string, userMessage: string): Promise<string> {
    return this.chat(instructions, userMessage, false);
  }

  async json(instructions: string, userMessage: string): Promise<unknown> {
    const content = await this.chat(`${instructions}\n\nResponde únicamente con JSON válido.`, userMessage, true);
    return parseJsonLoose(content);
  }

  private async chat(system: string, user: string, json: boolean): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: json ? 0 : 0.3,
      max_tokens: json ? 300 : 600,
    };
    if (json) body.response_format = { type: "json_object" };

    let res = await this.post(body);
    // Algunos proveedores detrás de un router no aceptan response_format: reintentamos sin él.
    if (res.status === 400 && json) {
      delete body.response_format;
      res = await this.post(body);
    }

    const data = (await res.json().catch(() => ({}))) as ChatResponse;
    if (!res.ok) {
      const hint = res.status === 503 ? " (¿el nombre del modelo coincide exactamente con el del proveedor?)" : "";
      throw new Error(`El LLM respondió ${res.status}: ${data.error?.message ?? res.statusText}${hint}`);
    }
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("El LLM devolvió una respuesta vacía");
    return content.trim();
  }

  private post(body: unknown): Promise<Response> {
    return this.fetchImpl(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.opts.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 25_000),
    });
  }
}

/** Acepta JSON envuelto en ```json … ``` o con texto alrededor. */
export function parseJsonLoose(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? content).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("El LLM no devolvió JSON");
  }
}
