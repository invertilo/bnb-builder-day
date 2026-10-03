import { createHmac } from "node:crypto";
import type { FetchLike } from "./public.js";
import { BinanceApiError } from "./errors.js";

/**
 * Cliente firmado de la Binance Web3 API (Trading / Market / Wallet / Transaction).
 * Firma: Base64(HMAC-SHA256(timestamp + MÉTODO + requestPath[?query] + body, secret)).
 * El requestPath firmado incluye el prefijo `/build` (la doc dice que olvidarlo es la causa nº1 del error 40102).
 */
export const WEB3_ORIGIN = "https://web3.binance.com";
export const WEB3_PREFIX = "/build";

export interface Credentials {
  apiKey: string;
  apiSecret: string;
}

export function sign(secret: string, timestamp: string, method: string, requestPath: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}${method.toUpperCase()}${requestPath}${body}`).digest("base64");
}

/** Query string con encodeURIComponent (espacios como %20, no "+"), en el orden dado. */
export function encodeQuery(params: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

interface Envelope<T> {
  code: number | string;
  msg?: string;
  message?: string;
  data: T;
}

export class BinanceWeb3 {
  constructor(
    private readonly creds: Credentials,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    return this.request<T>("GET", path, params);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, {}, body);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string | number | boolean | undefined>,
    body?: unknown,
  ): Promise<T> {
    const query = encodeQuery(params);
    const requestPath = `${WEB3_PREFIX}${path}${query ? `?${query}` : ""}`;
    const bodyText = body === undefined ? "" : JSON.stringify(body);
    const timestamp = this.now().toISOString();

    const res = await this.fetchImpl(`${WEB3_ORIGIN}${requestPath}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-OC-APIKEY": this.creds.apiKey,
        "X-OC-TIMESTAMP": timestamp,
        "X-OC-SIGN": sign(this.creds.apiSecret, timestamp, method, requestPath, bodyText),
        "X-OC-RECV-WINDOW": "10000",
      },
      body: method === "POST" ? bodyText : undefined,
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 429) throw new BinanceApiError(42900, "rate limit", path);
    const text = await res.text();
    let env: Envelope<T>;
    try {
      env = JSON.parse(text) as Envelope<T>;
    } catch {
      throw new BinanceApiError(res.status, text.slice(0, 200) || res.statusText, path);
    }
    // Market, Wallet y Transaction responden HTTP 200 con `code` distinto de 0 cuando fallan.
    if (String(env.code) !== "0") throw new BinanceApiError(env.code, env.msg ?? env.message ?? "error", path);
    return env.data;
  }
}
