import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Basket, Side } from "./domain/types.js";

export interface TradeRecord {
  at: string; // ISO
  userId: number;
  ticker: string;
  tokenSymbol: string;
  side: Side;
  usd: number;
  txHash: string;
}

export interface DcaPlan {
  id: string;
  userId: number;
  basketId: string;
  usd: number;
  everyDays: number;
  nextRunAt: string; // ISO
}

/**
 * Estado del agente. Dos implementaciones: FileStore (local, un proceso) y RedisStore
 * (Vercel / serverless, donde cada request puede caer en otra instancia).
 */
export interface StateStore {
  baskets(userId: number): Promise<Basket[]>;
  upsertBasket(userId: number, basket: Basket): Promise<void>;
  deleteBasket(userId: number, basketId: string): Promise<boolean>;
  recordTrade(trade: TradeRecord): Promise<void>;
  /** USD comprados por el usuario en las últimas 24 h (para el límite diario). */
  spentLast24h(userId: number, now?: Date): Promise<number>;
  /** Más recientes primero. */
  history(userId: number, limit?: number): Promise<TradeRecord[]>;
  dcaPlans(userId?: number): Promise<DcaPlan[]>;
  upsertDca(plan: DcaPlan): Promise<void>;
  deleteDca(userId: number, id: string): Promise<boolean>;
  /** Guarda una operación pendiente de confirmar; vence sola a los `ttlSec`. */
  savePending(userId: number, id: string, value: unknown, ttlSec: number): Promise<void>;
  /** Devuelve y borra en un solo paso: dos clics en "Confirmar" no ejecutan dos veces. */
  takePending<T>(userId: number, id: string): Promise<T | null>;
  /** Contador con ventana (rate limit). Devuelve el valor después de incrementar. */
  hit(key: string, windowSec: number): Promise<number>;
}

/** JSON que preserva bigint (las cotizaciones guardan montos en wei). */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? { $bigint: v.toString() } : v));
}

export function fromJson<T>(text: string): T {
  return JSON.parse(text, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v.$bigint === "string" ? BigInt(v.$bigint) : v,
  ) as T;
}

interface FileState {
  baskets: Record<string, Basket[]>;
  dca: DcaPlan[];
  ledger: TradeRecord[];
}

const EMPTY: FileState = { baskets: {}, dca: [], ledger: [] };

/** Persistencia en un archivo JSON. Suficiente para un agente personal en un solo proceso. */
export class FileStore implements StateStore {
  private state: FileState | null = null;
  private writing: Promise<void> = Promise.resolve();
  private pending = new Map<string, { expiresAt: number; text: string }>();
  private counters = new Map<string, { expiresAt: number; count: number }>();

  constructor(private readonly path: string) {}

  private async load(): Promise<FileState> {
    if (this.state) return this.state;
    try {
      this.state = { ...EMPTY, ...JSON.parse(await readFile(this.path, "utf8")) } as FileState;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      this.state = structuredClone(EMPTY);
    }
    return this.state;
  }

  private async save(): Promise<void> {
    const snapshot = JSON.stringify(this.state, null, 2);
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, snapshot);
      await rename(tmp, this.path);
    });
    return this.writing;
  }

  async baskets(userId: number): Promise<Basket[]> {
    return (await this.load()).baskets[userId] ?? [];
  }

  async upsertBasket(userId: number, basket: Basket): Promise<void> {
    const s = await this.load();
    const list = (s.baskets[userId] ??= []);
    const i = list.findIndex((b) => b.id === basket.id);
    if (i >= 0) list[i] = basket;
    else list.push(basket);
    await this.save();
  }

  async deleteBasket(userId: number, basketId: string): Promise<boolean> {
    const s = await this.load();
    const list = s.baskets[userId] ?? [];
    const next = list.filter((b) => b.id !== basketId);
    s.baskets[userId] = next;
    s.dca = s.dca.filter((d) => !(d.userId === userId && d.basketId === basketId));
    await this.save();
    return next.length !== list.length;
  }

  async recordTrade(trade: TradeRecord): Promise<void> {
    (await this.load()).ledger.push(trade);
    await this.save();
  }

  async spentLast24h(userId: number, now = new Date()): Promise<number> {
    return sumBoughtSince((await this.load()).ledger, userId, now);
  }

  async history(userId: number, limit = 10): Promise<TradeRecord[]> {
    return (await this.load()).ledger.filter((t) => t.userId === userId).slice(-limit).reverse();
  }

  async dcaPlans(userId?: number): Promise<DcaPlan[]> {
    const all = (await this.load()).dca;
    return userId === undefined ? all : all.filter((d) => d.userId === userId);
  }

  async upsertDca(plan: DcaPlan): Promise<void> {
    const s = await this.load();
    const i = s.dca.findIndex((d) => d.id === plan.id);
    if (i >= 0) s.dca[i] = plan;
    else s.dca.push(plan);
    await this.save();
  }

  async deleteDca(userId: number, id: string): Promise<boolean> {
    const s = await this.load();
    const before = s.dca.length;
    s.dca = s.dca.filter((d) => !(d.userId === userId && d.id === id));
    await this.save();
    return s.dca.length !== before;
  }

  async savePending(userId: number, id: string, value: unknown, ttlSec: number): Promise<void> {
    this.pending.set(`${userId}:${id}`, { expiresAt: Date.now() + ttlSec * 1000, text: toJson(value) });
  }

  async takePending<T>(userId: number, id: string): Promise<T | null> {
    const key = `${userId}:${id}`;
    const hit = this.pending.get(key);
    this.pending.delete(key);
    return hit && hit.expiresAt > Date.now() ? fromJson<T>(hit.text) : null;
  }

  async hit(key: string, windowSec: number): Promise<number> {
    const now = Date.now();
    const c = this.counters.get(key);
    const next = c && c.expiresAt > now ? { ...c, count: c.count + 1 } : { expiresAt: now + windowSec * 1000, count: 1 };
    this.counters.set(key, next);
    return next.count;
  }
}

export function sumBoughtSince(ledger: TradeRecord[], userId: number, now: Date): number {
  const since = now.getTime() - 24 * 60 * 60 * 1000;
  return ledger
    .filter((t) => t.userId === userId && t.side === "buy" && Date.parse(t.at) >= since)
    .reduce((sum, t) => sum + t.usd, 0);
}
