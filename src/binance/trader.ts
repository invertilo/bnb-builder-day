import { randomUUID } from "node:crypto";
import { encodeFunctionData, erc20Abi, formatUnits, keccak256, parseUnits, type Hex, type PublicClient, type TypedDataDefinition } from "viem";
import type { Address, Side, StockToken } from "../domain/types.js";
import type { MarketData, Portfolio, Position, Quote, Simulation, Trader } from "../ports.js";
import type { Signer } from "../wallet/signer.js";
import type { BinanceWeb3 } from "./auth.js";
import { BinanceApiError } from "./errors.js";

/** USDT en BSC: 18 decimales (no 6 como en otras cadenas; el ejemplo de la doc de Binance usa 6). */
export const USDT: { address: Address; decimals: number } = {
  address: "0x55d398326f99059ff775485246999027b3197955",
  decimals: 18,
};
const CHAIN_ID = "56";
/** La doc indica que un quoteId vive ~30 s: si es más viejo, recotizamos antes de ejecutar. */
const REQUOTE_AFTER_MS = 20_000;
const MIN_GAS_BNB = 0.0005;

interface Route {
  quoteId: string;
  vendorName: string;
  toTokenAmount: string;
  priceImpactPercent?: string | number | null;
  executionMode: "SWAP" | "RFQ";
  approveTarget?: string | null;
  isBest?: boolean;
}

interface RawQuote {
  route: Route;
  from: { address: Address; decimals: number };
  to: { address: Address; decimals: number };
  amountWei: bigint;
  /** Salida esperada en unidades mínimas del token de salida. */
  expectedOutWei: bigint;
  fetchedAt: number;
}

interface SwapTx {
  from?: string;
  to: string;
  data: string;
  value?: string;
  gas?: string;
  minReceiveAmount?: string;
}
interface SwapRfq {
  vendor: string;
  txType: string;
  typedDataToSign: string | Record<string, unknown>;
  signingScheme?: string;
  orderId: string;
}
type SwapData = { tx?: SwapTx; rfq?: SwapRfq };

interface OrderStatus {
  status: "FILLED" | "FAILED" | "EXPIRED" | "CANCELLED" | "PENDING_VENDOR" | "PENDING_ONCHAIN" | string;
  txHash?: string | null;
  failReason?: string | null;
}

interface SimulateResult {
  status?: string;
  failReason?: string | null;
}

export interface TraderOptions {
  slippageBps: number;
  mevProtection: boolean;
  /** Para tests: pausa entre consultas de estado. */
  sleep?: (ms: number) => Promise<void>;
}

export class BinanceTrader implements Trader {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly api: BinanceWeb3,
    private readonly signer: Signer,
    private readonly chain: PublicClient,
    private readonly market: MarketData,
    private readonly opts: TraderOptions,
  ) {
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  explorerTxUrl(txHash: string): string {
    return `https://bscscan.com/tx/${txHash}`;
  }

  // ── Cotización ─────────────────────────────────────────────────────────────

  async quote(token: StockToken, side: Side, usd: number, opts: { all?: boolean } = {}): Promise<Quote> {
    const price = await this.market.price(token);
    const tokenSide = { address: token.address, decimals: token.decimals };
    const from = side === "buy" ? USDT : tokenSide;
    const to = side === "buy" ? tokenSide : USDT;

    let amountWei: bigint;
    if (side === "buy") {
      amountWei = parseUnits(usd.toFixed(6), USDT.decimals);
    } else {
      const balance = await this.balanceOf(token.address);
      if (balance === 0n) throw new Error(`No tienes ${token.symbol} en la wallet del agente.`);
      const wanted = parseUnits((usd / price.onchainUsd).toFixed(Math.min(token.decimals, 12)), token.decimals);
      // Si pide casi todo (≥ 99%), vendemos todo para no dejar polvo.
      amountWei = opts.all || wanted * 100n >= balance * 99n ? balance : wanted;
    }

    const { route, outHuman } = await this.fetchRoute(from, to, amountWei, side === "buy" ? usd / price.onchainUsd : usd);
    const inHuman = Number(formatUnits(amountWei, from.decimals));
    const slip = this.opts.slippageBps / 10_000;
    const impact = Number(route.priceImpactPercent);

    return {
      token,
      side,
      usd: side === "buy" ? inHuman : outHuman,
      tokenAmount: side === "buy" ? outHuman : inHuman,
      minOut: outHuman * (1 - slip),
      slippageBps: this.opts.slippageBps,
      priceImpactBps: Number.isFinite(impact) ? Math.round(Math.abs(impact) * 100) : null,
      route: `${route.vendorName} · ${route.executionMode === "RFQ" ? "orden RFQ" : "swap"}`,
      raw: {
        route,
        from,
        to,
        amountWei,
        expectedOutWei: parseUnits(outHuman.toFixed(Math.min(to.decimals, 12)), to.decimals),
        fetchedAt: Date.now(),
      } satisfies RawQuote,
    };
  }

  private async fetchRoute(
    from: RawQuote["from"],
    to: RawQuote["to"],
    amountWei: bigint,
    expectedOut: number,
  ): Promise<{ route: Route; outHuman: number }> {
    const data = await this.api.get<Route[] | { routes?: Route[] } | Route>("/api/v1/dex/aggregator/quote", {
      binanceChainId: CHAIN_ID,
      amount: amountWei.toString(),
      fromTokenAddress: from.address,
      toTokenAddress: to.address,
      // Obligatorio para rutas RFQ (Ondo, bStocks).
      userWalletAddress: this.signer.address,
    });
    const routes = Array.isArray(data) ? data : "routes" in data && data.routes ? data.routes : [data as Route];
    if (!routes.length) throw new BinanceApiError(40374, "sin rutas", "/quote");
    const route =
      routes.find((r) => r.isBest) ??
      [...routes].sort((a, b) => Number(b.toTokenAmount) - Number(a.toTokenAmount))[0]!;
    return { route, outHuman: parseTokenAmount(route.toTokenAmount, to.decimals, expectedOut) };
  }

  // ── Chequeos previos / simulación ──────────────────────────────────────────

  async simulate(quote: Quote): Promise<Simulation> {
    const raw = quote.raw as RawQuote;
    const notes: string[] = [];
    const fail = (error: string): Simulation => ({ ok: false, kind: "preflight", gasBnb: null, notes, error });

    const [bnbWei, fromBalance] = await Promise.all([
      this.chain.getBalance({ address: this.signer.address }),
      this.balanceOf(raw.from.address),
    ]);
    const bnb = Number(formatUnits(bnbWei, 18));
    if (bnb < MIN_GAS_BNB) return fail(`La wallet del agente necesita BNB para gas (tiene ${bnb.toFixed(5)} BNB).`);
    if (fromBalance < raw.amountWei) {
      const have = Number(formatUnits(fromBalance, raw.from.decimals));
      const label = quote.side === "buy" ? "USDT" : quote.token.symbol;
      return fail(`Saldo insuficiente de ${label}: la wallet tiene ${have.toFixed(4)}.`);
    }

    const price = await this.market.price(quote.token);
    if (!price.tradable.ok) return fail(`No se puede operar ${quote.token.symbol} ahora: ${price.tradable.reason}.`);

    const spender = await this.spenderFor(raw);
    const needsApproval = (await this.allowance(raw.from.address, spender)) < raw.amountWei;
    if (needsApproval) {
      notes.push(`Primero se aprueba el gasto de ${quote.side === "buy" ? "USDT" : quote.token.symbol} (una transacción extra con gas).`);
      const approve = this.approveTx(raw.from.address, spender, raw.amountWei);
      const sim = await this.simulateTx(approve);
      if (!sim.ok) return { ...fail(`La aprobación fallaría: ${sim.error}`), kind: "onchain" };
      return { ok: true, kind: "onchain", gasBnb: null, notes };
    }

    if (raw.route.executionMode === "RFQ") {
      notes.push("Ondo y bStocks se ejecutan como orden RFQ firmada: Binance la completa onchain.");
      return { ok: true, kind: "preflight", gasBnb: null, notes };
    }

    const swap = await this.buildSwap(raw);
    if (!swap.tx) return { ok: true, kind: "preflight", gasBnb: null, notes };
    const sim = await this.simulateTx({ to: swap.tx.to as Address, data: swap.tx.data as Hex, value: BigInt(swap.tx.value ?? "0") });
    if (!sim.ok) return { ...fail(sim.error ?? "la simulación falló"), kind: "onchain" };
    const gasPrice = await this.chain.getGasPrice();
    const gasBnb = swap.tx.gas ? Number(formatUnits(BigInt(swap.tx.gas) * gasPrice, 18)) : null;
    return { ok: true, kind: "onchain", gasBnb, notes };
  }

  // ── Ejecución ──────────────────────────────────────────────────────────────

  async execute(quote: Quote): Promise<{ txHash: string }> {
    let raw = quote.raw as RawQuote;

    const spender = await this.spenderFor(raw);
    if ((await this.allowance(raw.from.address, spender)) < raw.amountWei) {
      const hash = await this.sendTx(this.approveTx(raw.from.address, spender, raw.amountWei));
      await this.waitForTx(hash, "aprobación");
    }

    if (Date.now() - raw.fetchedAt > REQUOTE_AFTER_MS) raw = await this.requote(raw, quote);

    const swap = await this.buildSwap(raw);
    if (swap.rfq) return this.executeRfq(swap.rfq);
    if (!swap.tx) throw new Error("Binance no devolvió ni transacción ni orden RFQ.");

    // Defensa propia: el mínimo garantizado no puede ser peor que nuestra cotización menos el slippage.
    if (swap.tx.minReceiveAmount) {
      const floor = (raw.expectedOutWei * BigInt(10_000 - 2 * this.opts.slippageBps)) / 10_000n;
      if (BigInt(swap.tx.minReceiveAmount) < floor) {
        throw new Error("El mínimo garantizado por Binance es peor que tu slippage máximo. No envié nada.");
      }
    }

    const tx = {
      to: swap.tx.to as Address,
      data: swap.tx.data as Hex,
      value: BigInt(swap.tx.value ?? "0"),
      gas: swap.tx.gas ? (BigInt(swap.tx.gas) * 12n) / 10n : undefined,
    };
    const sim = await this.simulateTx(tx);
    if (!sim.ok) throw new Error(`La simulación final falló: ${sim.error}. No envié nada.`);

    const hash = await this.sendTx(tx);
    await this.waitForTx(hash, "swap");
    return { txHash: hash };
  }

  private async requote(raw: RawQuote, original: Quote): Promise<RawQuote> {
    const expected = Number(formatUnits(raw.expectedOutWei, raw.to.decimals));
    const { route, outHuman } = await this.fetchRoute(raw.from, raw.to, raw.amountWei, expected);
    if (outHuman < original.minOut) {
      throw new Error("El precio se movió más que tu slippage desde que confirmaste la cotización. No ejecuté nada.");
    }
    return {
      ...raw,
      route,
      expectedOutWei: parseUnits(outHuman.toFixed(Math.min(raw.to.decimals, 12)), raw.to.decimals),
      fetchedAt: Date.now(),
    };
  }

  private buildSwap(raw: RawQuote): Promise<SwapData> {
    return this.api
      .get<SwapData | SwapData[]>("/api/v1/dex/aggregator/swap", {
        binanceChainId: CHAIN_ID,
        amount: raw.amountWei.toString(),
        fromTokenAddress: raw.from.address,
        toTokenAddress: raw.to.address,
        userWalletAddress: this.signer.address,
        quoteId: raw.route.quoteId,
        slippagePercent: (this.opts.slippageBps / 100).toString(),
      })
      .then((d) => (Array.isArray(d) ? d[0]! : d));
  }

  private async executeRfq(rfq: SwapRfq): Promise<{ txHash: string }> {
    const typed = normalizeTypedData(typeof rfq.typedDataToSign === "string" ? JSON.parse(rfq.typedDataToSign) : rfq.typedDataToSign);
    const userSignature = await this.signer.signTypedData(typed);

    // El requestId se reutiliza si hay que reintentar, para que Binance no duplique la orden.
    const requestId = randomUUID();
    const submit = () =>
      this.api.post("/api/v1/dex/aggregator/order/submit", {
        requestId,
        userSignature,
        vendor: rfq.vendor,
        quoteId: rfq.orderId,
        signingScheme: rfq.signingScheme,
      });
    try {
      await submit();
    } catch (err) {
      if (!(err instanceof BinanceApiError) || err.code === 40401) throw err;
      await this.sleep(1_500);
      await submit();
    }

    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await this.sleep(2_000);
      const order = await this.api.get<OrderStatus>(`/api/v1/dex/aggregator/order/${encodeURIComponent(rfq.orderId)}`);
      if (order.status === "FILLED" && order.txHash) return { txHash: order.txHash };
      if (["FAILED", "EXPIRED", "CANCELLED"].includes(order.status)) {
        throw new Error(`La orden RFQ terminó en ${order.status}${order.failReason ? `: ${order.failReason}` : ""}.`);
      }
    }
    throw new Error(`La orden ${rfq.orderId} sigue pendiente después de 2 minutos. Revisa /historial más tarde.`);
  }

  // ── Transacciones ──────────────────────────────────────────────────────────

  private approveTx(token: Address, spender: Address, amount: bigint) {
    return { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }), value: 0n };
  }

  private async simulateTx(tx: { to: Address; data: Hex; value: bigint }): Promise<{ ok: boolean; error?: string }> {
    const res = await this.api.post<SimulateResult>("/api/v1/dex/pre-transaction/simulate", {
      binanceChainId: CHAIN_ID,
      evmTx: { from: this.signer.address, to: tx.to, value: tx.value.toString(), data: tx.data },
    });
    const ok = !res.status || /^(success|ok|true)$/i.test(String(res.status));
    return ok ? { ok } : { ok, error: res.failReason ?? String(res.status) };
  }

  /** Firma localmente y envía por Binance con protección MEV; si falla, por el RPC. */
  private async sendTx(tx: { to: Address; data: Hex; value: bigint; gas?: bigint }): Promise<Hex> {
    const signed = await this.signer.signTransaction(tx);
    const hash = keccak256(signed);
    try {
      await this.api.post("/api/v1/dex/pre-transaction/broadcast-transaction", {
        binanceChainId: CHAIN_ID,
        address: this.signer.address,
        signedTransaction: signed,
        enableMevProtection: this.opts.mevProtection,
      });
    } catch (err) {
      console.warn("[trader] broadcast por Binance falló, uso el RPC:", (err as Error).message);
      await this.chain.sendRawTransaction({ serializedTransaction: signed });
    }
    return hash;
  }

  private async waitForTx(hash: Hex, label: string): Promise<void> {
    const receipt = await this.chain.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error(`La transacción de ${label} se revirtió: ${this.explorerTxUrl(hash)}`);
  }

  private async spenderFor(raw: RawQuote): Promise<Address> {
    if (raw.route.approveTarget) return raw.route.approveTarget.toLowerCase() as Address;
    // Para Ondo/bStocks el spender depende del vendor (1inch, Permit2 de PcsX o VaultRelayer de CowSwap).
    const res = await this.api.get<{ dexContractAddress?: string; spender?: string } | Array<{ dexContractAddress?: string }>>(
      "/api/v1/dex/aggregator/approve-transaction",
      {
        binanceChainId: CHAIN_ID,
        tokenContractAddress: raw.from.address,
        approveAmount: raw.amountWei.toString(),
        vendor: raw.route.vendorName,
      },
    );
    const d = Array.isArray(res) ? res[0] : res;
    const spender = (d as { dexContractAddress?: string; spender?: string } | undefined)?.dexContractAddress ?? (d as { spender?: string } | undefined)?.spender;
    if (!spender) throw new Error("Binance no indicó a qué contrato aprobar el gasto.");
    return spender.toLowerCase() as Address;
  }

  private balanceOf(token: Address): Promise<bigint> {
    return this.chain.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [this.signer.address] });
  }

  private allowance(token: Address, spender: Address): Promise<bigint> {
    return this.chain.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [this.signer.address, spender] });
  }

  // ── Portafolio ─────────────────────────────────────────────────────────────

  async portfolio(): Promise<Portfolio> {
    const tokens = await this.market.listStocks();
    const [bnbWei, usdtWei, balances] = await Promise.all([
      this.chain.getBalance({ address: this.signer.address }),
      this.balanceOf(USDT.address),
      this.balancesOf(tokens),
    ]);

    const held = tokens.map((t, i) => ({ t, wei: balances[i] ?? 0n })).filter((x) => x.wei > 0n);
    const positions: Position[] = await Promise.all(
      held.map(async ({ t, wei }) => {
        const units = Number(formatUnits(wei, t.decimals));
        const price = await this.market.price(t).catch(() => null);
        return { token: t, units, valueUsd: price ? units * price.onchainUsd : 0 };
      }),
    );

    return {
      address: this.signer.address,
      stableUsd: Number(formatUnits(usdtWei, USDT.decimals)),
      bnb: Number(formatUnits(bnbWei, 18)),
      positions,
    };
  }

  /** balanceOf de todo el catálogo con Multicall3, en lotes. */
  private async balancesOf(tokens: StockToken[]): Promise<bigint[]> {
    const out: bigint[] = [];
    for (let i = 0; i < tokens.length; i += 150) {
      const chunk = tokens.slice(i, i + 150);
      const res = await this.chain.multicall({
        allowFailure: true,
        contracts: chunk.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [this.signer.address] }) as const),
      });
      for (const r of res) out.push(r.status === "success" ? (r.result as bigint) : 0n);
    }
    return out;
  }
}

/**
 * La API no deja claro si `toTokenAmount` viene en unidades mínimas o humanas.
 * Con decimales es humano; si es entero, elegimos la lectura más cercana a lo esperado por precio.
 */
export function parseTokenAmount(value: string | number, decimals: number, expected?: number): number {
  const s = String(value).trim();
  if (/[.eE]/.test(s)) return Number(s);
  const asRaw = Number(formatUnits(BigInt(s), decimals));
  const asHuman = Number(s);
  if (!expected || expected <= 0 || asRaw === 0) return asRaw === 0 ? asHuman : asRaw;
  const dist = (x: number) => (x > 0 ? Math.abs(Math.log(x / expected)) : Infinity);
  return dist(asRaw) <= dist(asHuman) ? asRaw : asHuman;
}

/** Convierte el JSON EIP-712 de Binance al formato de viem: sin EIP712Domain y con enteros como bigint. */
export function normalizeTypedData(input: {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}): TypedDataDefinition {
  const { EIP712Domain: _unused, ...types } = input.types;

  const convert = (type: string, value: unknown): unknown => {
    if (type.endsWith("[]")) return (value as unknown[]).map((v) => convert(type.slice(0, -2), v));
    if (/^u?int\d*$/.test(type)) return typeof value === "bigint" ? value : BigInt(value as string | number);
    const struct = types[type];
    if (struct && value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      return Object.fromEntries(struct.map((f) => [f.name, convert(f.type, obj[f.name])]));
    }
    return value;
  };

  const domain = { ...input.domain };
  if (domain.chainId !== undefined) domain.chainId = Number(domain.chainId);

  return {
    domain,
    types,
    primaryType: input.primaryType,
    message: convert(input.primaryType, input.message) as Record<string, unknown>,
  } as unknown as TypedDataDefinition;
}
