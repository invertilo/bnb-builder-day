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

interface State {
  baskets: Record<string, Basket[]>; // por userId
  dca: DcaPlan[];
  ledger: TradeRecord[];
}

const EMPTY: State = { baskets: {}, dca: [], ledger: [] };

/** Persistencia en un archivo JSON. Suficiente para un agente personal; escrituras serializadas. */
export class Store {
  private state: State | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  private async load(): Promise<State> {
    if (this.state) return this.state;
    try {
      this.state = { ...EMPTY, ...JSON.parse(await readFile(this.path, "utf8")) } as State;
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

  /** USD comprados por el usuario en las últimas 24 h (para el límite diario). */
  async spentLast24h(userId: number, now = new Date()): Promise<number> {
    const since = now.getTime() - 24 * 60 * 60 * 1000;
    return (await this.load()).ledger
      .filter((t) => t.userId === userId && t.side === "buy" && Date.parse(t.at) >= since)
      .reduce((sum, t) => sum + t.usd, 0);
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
}
