import { keccak256, type Hex, type PublicClient } from "viem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Address, StockToken } from "../domain/types.js";
import type { MarketData, PriceInfo } from "../ports.js";
import type { Signer } from "../wallet/signer.js";
import type { BinanceWeb3 } from "./auth.js";
import { BinanceTrader, normalizeTypedData, parseTokenAmount, USDT } from "./trader.js";

const WALLET = "0x00000000000000000000000000000000000000aa" as Address;
const SPENDER = "0x00000000000000000000000000000000000000bb" as Address;
const ROUTER = "0x00000000000000000000000000000000000000cc" as Address;
const NVDA: StockToken = { ticker: "NVDA", symbol: "NVDAon", name: "NVIDIA", issuer: "ondo", address: "0x00000000000000000000000000000000000000dd", decimals: 18 };
const E18 = 10n ** 18n;

type Handler = (params: Record<string, unknown>) => unknown;

class FakeApi {
  gets: Record<string, Handler> = {};
  posts: Record<string, Handler> = {};
  calls: { method: string; path: string; params: Record<string, unknown> }[] = [];
  async get(path: string, params: Record<string, unknown> = {}) {
    this.calls.push({ method: "GET", path, params });
    const h = Object.entries(this.gets).find(([p]) => path.startsWith(p))?.[1];
    if (!h) throw new Error(`GET no simulado: ${path}`);
    return h(params);
  }
  async post(path: string, body: Record<string, unknown>) {
    this.calls.push({ method: "POST", path, params: body });
    const h = this.posts[path];
    if (!h) throw new Error(`POST no simulado: ${path}`);
    return h(body);
  }
}

class FakeChain {
  bnb = E18 / 100n; // 0.01 BNB
  balances = new Map<string, bigint>();
  allowances = new Map<string, bigint>();
  receipts: Hex[] = [];
  async getBalance() { return this.bnb; }
  async getGasPrice() { return 1_000_000_000n; }
  async readContract({ address, functionName }: { address: string; functionName: string }) {
    if (functionName === "balanceOf") return this.balances.get(address.toLowerCase()) ?? 0n;
    if (functionName === "allowance") return this.allowances.get(address.toLowerCase()) ?? 0n;
    throw new Error(functionName);
  }
  async multicall({ contracts }: { contracts: { address: string }[] }) {
    return contracts.map((c) => ({ status: "success", result: this.balances.get(c.address.toLowerCase()) ?? 0n }));
  }
  async waitForTransactionReceipt({ hash }: { hash: Hex }) {
    this.receipts.push(hash);
    return { status: "success" };
  }
  async sendRawTransaction() { return "0x" as Hex; }
}

class FakeSigner implements Signer {
  address = WALLET;
  txs: { to: Address; data?: Hex }[] = [];
  typed: unknown[] = [];
  async signTransaction(tx: { to: Address; data?: Hex }) {
    this.txs.push(tx);
    return `0x0${this.txs.length}deadbeef` as Hex;
  }
  async signTypedData(t: unknown) {
    this.typed.push(t);
    return "0xsig" as Hex;
  }
}

const market: MarketData = {
  listStocks: async () => [NVDA],
  findStock: async () => [NVDA],
  price: async (token) =>
    ({ token, onchainUsd: 235, referenceUsd: 234.8, multiplier: 1, stock: null, change24hPct: 0, session: "open", tradable: { ok: true, reason: null }, fundamentals: null }) satisfies PriceInfo,
};

let api: FakeApi;
let chain: FakeChain;
let signer: FakeSigner;
let trader: BinanceTrader;

beforeEach(() => {
  api = new FakeApi();
  chain = new FakeChain();
  signer = new FakeSigner();
  trader = new BinanceTrader(api as unknown as BinanceWeb3, signer, chain as unknown as PublicClient, market, {
    slippageBps: 100,
    mevProtection: true,
    sleep: async () => {},
  });
  chain.balances.set(USDT.address, 100n * E18);
  api.posts["/api/v1/dex/pre-transaction/simulate"] = () => ({ status: "success" });
  api.posts["/api/v1/dex/pre-transaction/broadcast-transaction"] = () => ({});
});

const rfqRoute = { quoteId: "q1", vendorName: "PcsXRfq", toTokenAmount: "85000000000000000", priceImpactPercent: "0.1", executionMode: "RFQ", approveTarget: SPENDER, isBest: true };

describe("BinanceTrader", () => {
  it("cotiza una compra: 20 USDT → tokens en unidades humanas, pasando la wallet para RFQ", async () => {
    api.gets["/api/v1/dex/aggregator/quote"] = () => [rfqRoute];
    const q = await trader.quote(NVDA, "buy", 20);
    expect(q.tokenAmount).toBeCloseTo(0.085);
    expect(q.usd).toBe(20);
    expect(q.priceImpactBps).toBe(10);
    expect(q.route).toBe("PcsXRfq · orden RFQ");
    const call = api.calls.find((c) => c.path.endsWith("/quote"))!;
    expect(call.params).toMatchObject({ amount: (20n * E18).toString(), fromTokenAddress: USDT.address, toTokenAddress: NVDA.address, userWalletAddress: WALLET });
  });

  it("compra RFQ: firma la orden EIP-712, la envía y espera FILLED", async () => {
    api.gets["/api/v1/dex/aggregator/quote"] = () => [rfqRoute];
    chain.allowances.set(USDT.address, 1000n * E18);
    api.gets["/api/v1/dex/aggregator/swap"] = () => ({
      rfq: {
        vendor: "PcsXRfq",
        txType: "EIP712",
        orderId: "order-1",
        typedDataToSign: JSON.stringify({
          domain: { name: "Permit2", chainId: "56", verifyingContract: SPENDER },
          types: { EIP712Domain: [{ name: "name", type: "string" }], Order: [{ name: "amount", type: "uint256" }] },
          primaryType: "Order",
          message: { amount: "20000000000000000000" },
        }),
      },
    });
    let polls = 0;
    api.posts["/api/v1/dex/aggregator/order/submit"] = () => ({});
    api.gets["/api/v1/dex/aggregator/order/"] = () => (++polls < 2 ? { status: "PENDING_ONCHAIN" } : { status: "FILLED", txHash: "0xfilled" });

    const q = await trader.quote(NVDA, "buy", 20);
    const { txHash } = await trader.execute(q);

    expect(txHash).toBe("0xfilled");
    expect(signer.txs).toHaveLength(0); // sin aprobación ni transacción propia
    expect(signer.typed[0]).toMatchObject({ primaryType: "Order", domain: { chainId: 56 }, message: { amount: 20n * E18 } });
    expect((signer.typed[0] as { types: object }).types).not.toHaveProperty("EIP712Domain");
    const submit = api.calls.find((c) => c.path.endsWith("/order/submit"))!.params;
    expect(submit).toMatchObject({ userSignature: "0xsig", vendor: "PcsXRfq", quoteId: "order-1" });
    expect(String(submit.requestId)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("venta SWAP: aprueba si hace falta, simula, envía con protección MEV y espera el recibo", async () => {
    chain.balances.set(NVDA.address, E18 / 10n); // 0.1 NVDAon
    api.gets["/api/v1/dex/aggregator/quote"] = () => [{ quoteId: "q2", vendorName: "LiquidMesh", toTokenAmount: "23400000000000000000", executionMode: "SWAP", approveTarget: ROUTER, isBest: true }];
    api.gets["/api/v1/dex/aggregator/swap"] = () => ({ tx: { to: ROUTER, data: "0xabcdef", value: "0", gas: "200000", minReceiveAmount: "23166000000000000000" } });

    const q = await trader.quote(NVDA, "sell", 0, { all: true });
    expect(q.tokenAmount).toBeCloseTo(0.1);
    expect(q.usd).toBeCloseTo(23.4);

    const { txHash } = await trader.execute(q);
    expect(signer.txs[0]!.to).toBe(NVDA.address); // approve
    expect(signer.txs[1]!.to).toBe(ROUTER); // swap
    expect(txHash).toBe(keccak256("0x02deadbeef"));
    expect(chain.receipts).toHaveLength(2);
    const broadcast = api.calls.filter((c) => c.path.endsWith("/broadcast-transaction"));
    expect(broadcast.at(-1)!.params).toMatchObject({ enableMevProtection: true, address: WALLET });
  });

  it("no envía si el mínimo garantizado es peor que el slippage", async () => {
    chain.allowances.set(USDT.address, 1000n * E18);
    api.gets["/api/v1/dex/aggregator/quote"] = () => [{ ...rfqRoute, executionMode: "SWAP" }];
    api.gets["/api/v1/dex/aggregator/swap"] = () => ({ tx: { to: ROUTER, data: "0x01", value: "0", minReceiveAmount: "1" } });
    const q = await trader.quote(NVDA, "buy", 20);
    await expect(trader.execute(q)).rejects.toThrow("mínimo garantizado");
    expect(signer.txs).toHaveLength(0);
  });

  it("si la cotización es vieja recotiza y aborta cuando el precio empeoró", async () => {
    chain.allowances.set(USDT.address, 1000n * E18);
    let first = true;
    api.gets["/api/v1/dex/aggregator/quote"] = () => {
      const out = first ? "85000000000000000" : "80000000000000000";
      first = false;
      return [{ ...rfqRoute, toTokenAmount: out }];
    };
    const q = await trader.quote(NVDA, "buy", 20);
    (q.raw as { fetchedAt: number }).fetchedAt -= 25_000;
    await expect(trader.execute(q)).rejects.toThrow("El precio se movió");
  });

  it("chequeos previos: sin USDT suficiente o sin BNB para gas", async () => {
    api.gets["/api/v1/dex/aggregator/quote"] = () => [rfqRoute];
    chain.balances.set(USDT.address, 5n * E18);
    const q = await trader.quote(NVDA, "buy", 20);
    expect((await trader.simulate(q)).error).toContain("Saldo insuficiente de USDT");

    chain.bnb = 0n;
    expect((await trader.simulate(q)).error).toContain("BNB para gas");
  });

  it("chequeos previos RFQ con allowance: OK y lo explica", async () => {
    api.gets["/api/v1/dex/aggregator/quote"] = () => [rfqRoute];
    chain.allowances.set(USDT.address, 1000n * E18);
    const sim = await trader.simulate(await trader.quote(NVDA, "buy", 20));
    expect(sim).toMatchObject({ ok: true, kind: "preflight" });
    expect(sim.notes[0]).toContain("RFQ");
  });

  it("portafolio: saldos onchain de todo el catálogo", async () => {
    chain.balances.set(NVDA.address, E18 / 10n);
    const pf = await trader.portfolio();
    expect(pf.stableUsd).toBe(100);
    expect(pf.positions).toHaveLength(1);
    expect(pf.positions[0]!.valueUsd).toBeCloseTo(23.5);
  });
});

describe("parseTokenAmount", () => {
  it("con decimales es una cantidad humana", () => expect(parseTokenAmount("0.0851", 18)).toBe(0.0851));
  it("entero grande = unidades mínimas", () => expect(parseTokenAmount("85000000000000000", 18, 0.085)).toBeCloseTo(0.085));
  it("entero chico = humano cuando eso coincide con lo esperado", () => expect(parseTokenAmount("23", 18, 23.4)).toBe(23));
});

describe("normalizeTypedData", () => {
  it("quita EIP712Domain y convierte enteros anidados y arrays a bigint", () => {
    const t = normalizeTypedData({
      domain: { chainId: "56" },
      types: {
        EIP712Domain: [],
        Order: [{ name: "inner", type: "Inner" }, { name: "ids", type: "uint256[]" }, { name: "owner", type: "address" }],
        Inner: [{ name: "amount", type: "uint128" }],
      },
      primaryType: "Order",
      message: { inner: { amount: "5" }, ids: ["1", "2"], owner: WALLET },
    }) as unknown as { domain: { chainId: number }; types: object; message: { inner: { amount: bigint }; ids: bigint[]; owner: string } };
    expect(t.domain.chainId).toBe(56);
    expect(t.types).not.toHaveProperty("EIP712Domain");
    expect(t.message.inner.amount).toBe(5n);
    expect(t.message.ids).toEqual([1n, 2n]);
    expect(t.message.owner).toBe(WALLET);
  });
});
