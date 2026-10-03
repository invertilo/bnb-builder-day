import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { FileStore, fromJson, toJson, type StateStore, type TradeRecord } from "./store.js";
import { RedisStore, type RedisLike } from "./store-redis.js";

/** Doble en memoria con la semántica de Upstash que usamos. */
class FakeRedis implements RedisLike {
  kv = new Map<string, { v: string; exp?: number }>();
  lists = new Map<string, string[]>();
  hashes = new Map<string, Map<string, string>>();
  private alive(key: string) {
    const e = this.kv.get(key);
    if (e?.exp !== undefined && e.exp <= Date.now()) this.kv.delete(key);
    return this.kv.get(key);
  }
  async get(key: string) { return this.alive(key)?.v ?? null; }
  async set(key: string, v: string, opts?: { ex: number }) { this.kv.set(key, { v, exp: opts ? Date.now() + opts.ex * 1000 : undefined }); return "OK"; }
  async getdel(key: string) { const v = this.alive(key)?.v ?? null; this.kv.delete(key); return v; }
  async lpush(key: string, ...values: string[]) { const l = this.lists.get(key) ?? []; l.unshift(...values.reverse()); this.lists.set(key, l); return l.length; }
  async ltrim(key: string, start: number, stop: number) { this.lists.set(key, (this.lists.get(key) ?? []).slice(start, stop + 1)); return "OK"; }
  async lrange(key: string, start: number, stop: number) { return (this.lists.get(key) ?? []).slice(start, stop + 1); }
  async hset(key: string, values: Record<string, string>) { const h = this.hashes.get(key) ?? new Map(); Object.entries(values).forEach(([f, v]) => h.set(f, v)); this.hashes.set(key, h); return 1; }
  async hgetall(key: string) { const h = this.hashes.get(key); return h ? Object.fromEntries(h) : null; }
  async hdel(key: string, ...fields: string[]) { const h = this.hashes.get(key); let n = 0; fields.forEach((f) => { if (h?.delete(f)) n++; }); return n; }
  async incr(key: string) { const n = Number(this.alive(key)?.v ?? 0) + 1; const exp = this.kv.get(key)?.exp; this.kv.set(key, { v: String(n), exp }); return n; }
  async expire(key: string, s: number) { const e = this.kv.get(key); if (!e) return 0; e.exp = Date.now() + s * 1000; return 1; }
}

const trade = (usd: number, at = new Date().toISOString()): TradeRecord => ({ at, userId: 1, ticker: "NVDA", tokenSymbol: "NVDAon", side: "buy", usd, txHash: "0x1" });

describe("toJson / fromJson", () => {
  it("preserva bigint dentro de objetos anidados", () => {
    const v = { amountWei: 25n * 10n ** 18n, nested: [{ x: 1n }], s: "hola" };
    expect(fromJson(toJson(v))).toEqual(v);
  });
});

for (const [name, make] of [
  ["FileStore", async () => new FileStore(join(await mkdtemp(join(tmpdir(), "pa-")), "s.json"))],
  ["RedisStore", async () => new RedisStore(new FakeRedis())],
] as const) {
  describe(name, () => {
    let store: StateStore;
    beforeEach(async () => {
      store = await make();
    });

    it("canastas: crea, actualiza y borra (con su DCA)", async () => {
      await store.upsertBasket(1, { id: "chips", name: "chips", weights: { NVDA: 1 } });
      await store.upsertBasket(1, { id: "chips", name: "chips", weights: { NVDA: 0.5, AMD: 0.5 } });
      expect(await store.baskets(1)).toHaveLength(1);
      await store.upsertDca({ id: "chips-7d", userId: 1, basketId: "chips", usd: 20, everyDays: 7, nextRunAt: new Date().toISOString() });
      expect(await store.deleteBasket(1, "chips")).toBe(true);
      expect(await store.dcaPlans(1)).toEqual([]);
    });

    it("historial (más nuevo primero) y gasto de las últimas 24 h", async () => {
      await store.recordTrade(trade(10, new Date(Date.now() - 30 * 3600_000).toISOString()));
      await store.recordTrade(trade(20));
      await store.recordTrade(trade(5));
      expect((await store.history(1, 2)).map((t) => t.usd)).toEqual([5, 20]);
      expect(await store.spentLast24h(1)).toBe(25);
    });

    it("pendientes: se toman una sola vez y solo el dueño", async () => {
      await store.savePending(1, "abc", { amount: 7n }, 60);
      expect(await store.takePending(2, "abc")).toBeNull(); // otro usuario
      expect(await store.takePending(1, "abc")).toEqual({ amount: 7n });
      expect(await store.takePending(1, "abc")).toBeNull(); // segundo clic
    });

    it("DCA: solo el dueño puede borrar", async () => {
      await store.upsertDca({ id: "d1", userId: 1, basketId: "b", usd: 10, everyDays: 1, nextRunAt: "2026-10-03T00:00:00Z" });
      expect(await store.deleteDca(2, "d1")).toBe(false);
      expect(await store.deleteDca(1, "d1")).toBe(true);
    });

    it("hit cuenta por ventana", async () => {
      expect(await store.hit("k", 60)).toBe(1);
      expect(await store.hit("k", 60)).toBe(2);
    });
  });
}
