import { Redis } from "@upstash/redis";
import type { Basket } from "./domain/types.js";
import { fromJson, sumBoughtSince, toJson, type DcaPlan, type StateStore, type TradeRecord } from "./store.js";

/** Lo mínimo de Upstash Redis que usamos (permite un doble en memoria para tests). */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ex: number }): Promise<unknown>;
  getdel(key: string): Promise<string | null>;
  lpush(key: string, ...values: string[]): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  hset(key: string, values: Record<string, string>): Promise<number>;
  hgetall(key: string): Promise<Record<string, string> | null>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

const LEDGER_MAX = 500;

/** Estado en Upstash Redis (HTTP): funciona en Vercel, donde no hay disco ni memoria compartida. */
export class RedisStore implements StateStore {
  constructor(
    private readonly redis: RedisLike,
    private readonly prefix = "pa",
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): RedisStore | null {
    const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
    const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    // Sin deserialización automática: guardamos JSON propio que preserva bigint.
    return new RedisStore(new Redis({ url, token, automaticDeserialization: false }) as unknown as RedisLike);
  }

  private k(...parts: Array<string | number>): string {
    return [this.prefix, ...parts].join(":");
  }

  async baskets(userId: number): Promise<Basket[]> {
    const raw = await this.redis.get(this.k("baskets", userId));
    return raw ? fromJson<Basket[]>(raw) : [];
  }

  async upsertBasket(userId: number, basket: Basket): Promise<void> {
    const list = await this.baskets(userId);
    const i = list.findIndex((b) => b.id === basket.id);
    if (i >= 0) list[i] = basket;
    else list.push(basket);
    await this.redis.set(this.k("baskets", userId), toJson(list));
  }

  async deleteBasket(userId: number, basketId: string): Promise<boolean> {
    const list = await this.baskets(userId);
    const next = list.filter((b) => b.id !== basketId);
    await this.redis.set(this.k("baskets", userId), toJson(next));
    const plans = (await this.dcaPlans(userId)).filter((d) => d.basketId === basketId);
    if (plans.length) await this.redis.hdel(this.k("dca"), ...plans.map((p) => p.id));
    return next.length !== list.length;
  }

  async recordTrade(trade: TradeRecord): Promise<void> {
    const key = this.k("ledger", trade.userId);
    await this.redis.lpush(key, toJson(trade));
    await this.redis.ltrim(key, 0, LEDGER_MAX - 1);
  }

  private async ledger(userId: number, limit: number): Promise<TradeRecord[]> {
    const rows = await this.redis.lrange(this.k("ledger", userId), 0, limit - 1);
    return rows.map((r) => fromJson<TradeRecord>(r));
  }

  async spentLast24h(userId: number, now = new Date()): Promise<number> {
    return sumBoughtSince(await this.ledger(userId, 200), userId, now);
  }

  history(userId: number, limit = 10): Promise<TradeRecord[]> {
    return this.ledger(userId, limit);
  }

  async dcaPlans(userId?: number): Promise<DcaPlan[]> {
    const all = Object.values((await this.redis.hgetall(this.k("dca"))) ?? {}).map((v) => fromJson<DcaPlan>(v));
    return userId === undefined ? all : all.filter((d) => d.userId === userId);
  }

  async upsertDca(plan: DcaPlan): Promise<void> {
    await this.redis.hset(this.k("dca"), { [plan.id]: toJson(plan) });
  }

  async deleteDca(userId: number, id: string): Promise<boolean> {
    const plan = (await this.dcaPlans(userId)).find((d) => d.id === id);
    if (!plan) return false;
    return (await this.redis.hdel(this.k("dca"), id)) > 0;
  }

  async savePending(userId: number, id: string, value: unknown, ttlSec: number): Promise<void> {
    await this.redis.set(this.k("pending", userId, id), toJson(value), { ex: ttlSec });
  }

  async takePending<T>(userId: number, id: string): Promise<T | null> {
    const raw = await this.redis.getdel(this.k("pending", userId, id));
    return raw ? fromJson<T>(raw) : null;
  }

  async hit(key: string, windowSec: number): Promise<number> {
    const k = this.k("rl", key);
    const n = await this.redis.incr(k);
    if (n === 1) await this.redis.expire(k, windowSec);
    return n;
  }
}
