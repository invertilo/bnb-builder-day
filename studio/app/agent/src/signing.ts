/**
 * Deterministic signing — the Agent is the SOLE key-holder/signer.
 *
 * Every on-chain WRITE the Agent performs lives here as FIXED code:
 *
 *     signQuote(...)    EIP-191 sign the validated negotiated offer
 *     submitResult(...) build manifest → upload → on-chain `submit`
 *     settle(...)       claim payment after the dispute window
 *
 * These functions are NEVER registered as LLM-callable tools (`tools.ts` holds
 * only read-only tools). The price is FIXED by studio.toml — canonical
 * `[payments.seller].price_usd` per asset, or legacy `[payments.erc8183].price`
 * checked against independent bounds (`listPrice()`) — and `signQuote` picks
 * the right one; the LLM only produces the work text and never moves money or
 * sets a price.
 *
 * The key is loaded by `@bnbagent/studio-runtime/wallet` `getWallet()` (local
 * keystore, unlocked by `WALLET_PASSWORD`). It is injected into the AgentCore
 * runtime via the secret store, never bundled into the code package.
 *
 * You own this file — edit the pricing clamp source / manifest shape if your
 * domain needs it, but keep these ops OUT of the LLM tool list.
 */

import {
  JobDescription,
  NegotiationHandler,
  type NegotiationResult,
  type QuoteSigner,
} from "@bnbagent/sdk/erc8183";
import type { AssetId } from "@bnbagent/sdk/networks";
import {
  type TomlTable,
  loadStudioToml,
} from "@bnbagent/studio-runtime/config";
import {
  type SubmitResult,
  type Verdict,
  erc8183Network,
  get8183Client,
  settleWorkflow,
  submitWorkflow,
  verifySignedJob as verifySignedJobCore,
} from "@bnbagent/studio-runtime/erc8183";
import { usdPriceToAtomic } from "@bnbagent/studio-runtime/networks";
import {
  type ResolvedSellerPolicy,
  resolveSellerPolicy,
} from "@bnbagent/studio-runtime/policy";
import { getWallet } from "@bnbagent/studio-runtime/wallet";

const MAX_UINT256 = (1n << 256n) - 1n;

// ── test seams (mirror the studio-runtime `_set*` convention) ────────────────
type StudioTomlLoader = () => TomlTable;
const defaultTomlLoader: StudioTomlLoader = () => loadStudioToml();
let tomlLoader: StudioTomlLoader = defaultTomlLoader;

/** Test seam: replace the studio.toml loader. Pass null to restore. */
export function _setStudioTomlLoader(loader: StudioTomlLoader | null): void {
  tomlLoader = loader ?? defaultTomlLoader;
  handler = null; // config feeds the cached handler — rebuild it
  handlerKey = null;
}

/** The narrow NegotiationHandler surface signQuote drives (test-fakeable). */
export interface NegotiationHandlerLike {
  negotiate(
    request: Record<string, unknown>,
    opts?: { price?: string; estimatedCompletionSeconds?: number },
  ): Promise<NegotiationResult> | NegotiationResult;
}

let handler: NegotiationHandlerLike | Promise<NegotiationHandlerLike> | null =
  null;
const INJECTED_HANDLER_KEY = Symbol("injected-handler");
let handlerKey: string | typeof INJECTED_HANDLER_KEY | null = null;

type RuntimeWallet = ReturnType<typeof getWallet>;
type SessionQuoteWallet = RuntimeWallet & {
  sessionQuoteSigner(): QuoteSigner;
};

/** Select the narrow quote-only authority when the wallet exposes one. */
export function negotiationSignerOptions(
  wallet: RuntimeWallet,
): { quoteSigner: QuoteSigner } | { walletProvider: RuntimeWallet } {
  const candidate = wallet as Partial<SessionQuoteWallet>;
  return typeof candidate.sessionQuoteSigner === "function"
    ? { quoteSigner: candidate.sessionQuoteSigner.call(wallet) }
    : { walletProvider: wallet };
}

/** Test seam: replace the cached NegotiationHandler. Pass null to restore. */
export function _setNegotiationHandler(h: NegotiationHandlerLike | null): void {
  handler = h;
  handlerKey = h === null ? null : INJECTED_HANDLER_KEY;
}

// ── config readers ────────────────────────────────────────────────────────────

/** Read studio.toml once for one quote/config operation. */
function studioCfg(): TomlTable {
  try {
    return tomlLoader();
  } catch {
    // No studio.toml here; use the safe empty-config fallback.
    return {};
  }
}

/** Read `[payments.erc8183]` from studio.toml ({} when absent). */
function erc8183Cfg(cfg: TomlTable = studioCfg()): Record<string, unknown> {
  const payments = (cfg.payments ?? {}) as Record<string, unknown>;
  return (payments.erc8183 ?? {}) as Record<string, unknown>;
}

/**
 * Bind provider_sig to the same Commerce deployment used by the runtime
 * client. QA/custom stacks override the canonical SDK registry via env.
 */
export function commerceVerifyingContract(networkName: string): `0x${string}` {
  return erc8183Network(networkName).commerceContract as `0x${string}`;
}

/**
 * Return `[minPrice, maxPrice]` in raw wei from studio.toml.
 *
 * These are the required independent bounds checked against the list price BEFORE
 * signing. `min_price`/`max_price` are raw uint256 strings in
 * `[payments.erc8183]`.
 */
export function priceBounds(): [bigint, bigint] {
  const cfg = erc8183Cfg();
  const raw = (key: string): bigint => {
    const value = cfg[key];
    const s = String(value ?? "").trim();
    if (typeof value !== "string" || !/^[0-9]+$/.test(s) || BigInt(s) > MAX_UINT256) {
      throw new Error(`[payments.erc8183].${key} must be an explicit uint256 amount in token base units.`);
    }
    return BigInt(s);
  };
  const lo = raw("min_price");
  const hi = raw("max_price");
  if (lo > hi) throw new Error("min_price must not exceed max_price");
  return [lo, hi];
}

/**
 * Return the seller's list price in raw wei from studio.toml.
 *
 * Reads `[payments.erc8183].price` — the deterministic asking price every
 * quote uses (rule-based pricing; no LLM in the quote path). Empty/absent is rejected; write "0" explicitly for free work.
 * Edit `price` in studio.toml to change what you charge. The value is still
 * checked against `[minPrice, maxPrice]` by {@link clampPrice} before signing.
 */
export function listPrice(): bigint {
  const value = erc8183Cfg().price;
  const s = String(value ?? "").trim();
  if (typeof value !== "string" || !/^[0-9]+$/.test(s) || BigInt(s) > MAX_UINT256) {
    throw new Error("[payments.erc8183].price must be an explicit uint256 amount; use 0 for free work.");
  }
  return clampPrice(BigInt(s));
}

/** Validate a price against `[minPrice, maxPrice]`; retained name for callers. */
export function clampPrice(proposedWei: bigint): bigint {
  const [lo, hi] = priceBounds();
  if (proposedWei < lo || proposedWei > hi) {
    throw new Error(`[payments.erc8183].price ${proposedWei} is outside [min_price=${lo}, max_price=${hi}]; correct the configuration before quoting.`);
  }
  return proposedWei;
}

type MultiAssetClient = Parameters<
  typeof NegotiationHandler.fromErc8183ClientMulti
>[0];

interface HandlerPlan {
  readonly key: string;
  readonly source: ResolvedSellerPolicy["source"];
  readonly networkName: string;
  readonly chainId: number;
  readonly commerceContract: string;
  readonly ttl: number;
  readonly estimatedCompletionSeconds: number;
  readonly currency: string;
  readonly servicePrices: Partial<Record<AssetId, string>> | null;
}

function normalizeContractAddress(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`multi-asset ERC-8183 client ${field} is invalid`);
  }
  return value.toLowerCase();
}

/** Validate the SDK surface hidden by Studio's legacy narrow facade. */
function requireMultiAssetClient(
  client: unknown,
  plan: HandlerPlan,
): MultiAssetClient {
  if (client === null || typeof client !== "object") {
    throw new Error("multi-asset ERC-8183 client is unavailable");
  }
  const candidate = client as Record<string, unknown>;
  const network = candidate.network;
  if (network === null || typeof network !== "object") {
    throw new Error("multi-asset ERC-8183 client network is unavailable");
  }
  const networkRecord = network as Record<string, unknown>;
  if (networkRecord.chainId !== plan.chainId) {
    throw new Error("multi-asset ERC-8183 client chain mismatch");
  }
  const expectedCommerce = normalizeContractAddress(
    plan.commerceContract,
    "expected Commerce address",
  );
  if (
    normalizeContractAddress(
      networkRecord.commerceContract,
      "network Commerce address",
    ) !== expectedCommerce
  ) {
    throw new Error("multi-asset ERC-8183 client Commerce domain mismatch");
  }
  const commerce = candidate.commerce;
  if (commerce === null || typeof commerce !== "object") {
    throw new Error("multi-asset ERC-8183 client commerce is unavailable");
  }
  if (
    normalizeContractAddress(
      (commerce as Record<string, unknown>).address,
      "commerce.address",
    ) !== expectedCommerce
  ) {
    throw new Error("multi-asset ERC-8183 client Commerce domain mismatch");
  }
  if (typeof candidate.isPaymentTokenSupported !== "function") {
    throw new Error(
      "multi-asset ERC-8183 client isPaymentTokenSupported is unavailable",
    );
  }
  return client as MultiAssetClient;
}

function handlerPlan(
  cfg: TomlTable,
  resolved: ResolvedSellerPolicy,
): HandlerPlan {
  const railCfg = erc8183Cfg(cfg);
  const ttl = Number(railCfg.quote_ttl_seconds ?? 900);
  const estimatedCompletionSeconds = Number(
    railCfg.default_estimated_completion_seconds ?? 600,
  );
  const domain = erc8183Network(resolved.policy.network);
  let currency = "";
  let servicePrices: Partial<Record<AssetId, string>> | null = null;
  let policyFacts: readonly unknown[];

  if (resolved.source === "canonical") {
    if (resolved.policy.price.kind !== "usd") {
      throw new Error("canonical seller policy must use a USD price");
    }
    const priceUsd = resolved.policy.price.value;
    servicePrices = Object.fromEntries(
      resolved.policy.assets.map((assetId) => [
        assetId,
        usdPriceToAtomic(resolved.policy.network, assetId, priceUsd).toString(),
      ]),
    ) as Partial<Record<AssetId, string>>;
    policyFacts = [
      "canonical",
      priceUsd,
      [...resolved.policy.assets],
      Object.entries(servicePrices),
    ];
  } else {
    currency = String(railCfg.currency ?? "");
    policyFacts = ["legacy", currency, "servicePrice=0"];
  }

  const key = JSON.stringify({
    source: resolved.source,
    network: resolved.policy.network,
    policyFacts,
    ttl: String(ttl),
    estimatedCompletionSeconds: String(estimatedCompletionSeconds),
    chainId: domain.chainId,
    commerceContract: domain.commerceContract.toLowerCase(),
    routerContract: domain.routerContract.toLowerCase(),
    policyContract: domain.policyContract.toLowerCase(),
  });
  return {
    key,
    source: resolved.source,
    networkName: resolved.policy.network,
    chainId: domain.chainId,
    commerceContract: domain.commerceContract,
    ttl,
    estimatedCompletionSeconds,
    currency,
    servicePrices,
  };
}

/**
 * Return the process-wide NegotiationHandler (lazy, cached).
 *
 * Canonical `[payments.seller]` builds the SDK's catalog-bound multi-asset
 * handler. Every configured AssetId receives the same USD price converted
 * exactly to that asset's atomic units; the SDK refreshes the Commerce
 * allowlist before each negotiation and owns requested-currency selection.
 *
 * Legacy `[payments.erc8183]` keeps its original raw atomic price/currency
 * behavior. Its per-request clamp remains in {@link signQuote}; canonical USD
 * prices are never reinterpreted as legacy atomic units.
 */
async function getHandler(plan: HandlerPlan): Promise<NegotiationHandlerLike> {
  if (handlerKey === INJECTED_HANDLER_KEY && handler !== null) {
    return await handler;
  }
  if (handler === null || handlerKey !== plan.key) {
    const pending = (async (): Promise<NegotiationHandlerLike> => {
      const wallet = getWallet();

      if (plan.source === "canonical") {
        if (plan.servicePrices === null) {
          throw new Error("canonical seller handler has no service prices");
        }
        const client = requireMultiAssetClient(
          await get8183Client(plan.networkName),
          plan,
        );
        return NegotiationHandler.fromErc8183ClientMulti(client, {
          servicePrices: plan.servicePrices,
          estimatedCompletionSeconds: plan.estimatedCompletionSeconds,
          ...negotiationSignerOptions(wallet),
          quoteTtlSeconds: plan.ttl,
        });
      }

      return new NegotiationHandler({
        servicePrice: "0", // legacy placeholder — overridden per quote
        currency: plan.currency,
        estimatedCompletionSeconds: plan.estimatedCompletionSeconds,
        ...negotiationSignerOptions(wallet),
        quoteTtlSeconds: plan.ttl,
        chainId: plan.chainId,
        verifyingContract: plan.commerceContract as `0x${string}`,
      });
    })();
    handler = pending;
    handlerKey = plan.key;
    try {
      return await pending;
    } catch (error) {
      // A transient initial allowlist/RPC failure must not poison the process
      // cache forever; the next request may safely retry construction.
      if (handler === pending && handlerKey === plan.key) {
        handler = null;
        handlerKey = null;
      }
      throw error;
    }
  }
  return await handler;
}

/**
 * Negotiate + EIP-191-sign a quote; return the SDK envelope.
 *
 * Reuses a process-wide NegotiationHandler. Legacy config quotes
 * `clampedPriceWei`, defaulting to the configured {@link listPrice}; canonical
 * multi-asset config deliberately does not pass a single-price override
 * because each token has its own atomic amount. Callers therefore never need
 * a price of their own — reading one would drag legacy `[payments.erc8183]`
 * requirements into canonical projects that have no such section.
 *
 * Returns the SDK's `NegotiationResult.toDict()` envelope **verbatim** — the
 * exact wire structure a buyer parses and feeds to `buildJobDescription` to
 * anchor on-chain (see docs/design/erc8183-reference.md §2). On accept it
 * carries `response.terms.price`/`currency`, `quote_expires_at`,
 * `negotiation_hash`, `response_hash`, `provider_sig`, `chain_id`,
 * `verifying_contract`; on reject it carries `response.reason_code` /
 * `reason` (empty hash + sig). We do NOT invent a custom shape.
 */
export async function signQuote(
  request: Record<string, unknown>,
  clampedPriceWei?: bigint,
): Promise<Record<string, unknown>> {
  const cfg = studioCfg();
  const resolved = resolveSellerPolicy(cfg, "erc8183");
  const plan = handlerPlan(cfg, resolved);
  // Validate the entire custom contract trio before signing, including when
  // tests inject a handler or a previously cached handler is reused.
  commerceVerifyingContract(plan.networkName);
  let legacyPriceWei = 0n;
  if (plan.source !== "canonical") {
    // Legacy single-price config still has to prove its own bounds: the
    // canonical seller policy is what supersedes them, nothing else.
    const configuredPriceWei = listPrice();
    legacyPriceWei = clampedPriceWei ?? configuredPriceWei;
    clampPrice(legacyPriceWei);
  }

  const activeHandler = await getHandler(plan);
  const result = await activeHandler.negotiate(
    request,
    plan.source === "canonical"
      ? { estimatedCompletionSeconds: plan.estimatedCompletionSeconds }
      : {
          price: String(legacyPriceWei),
          estimatedCompletionSeconds: plan.estimatedCompletionSeconds,
        },
  );

  // SDK 0.5.4 throws QuoteSigningError when signing fails. Keep this shape
  // check as defense in depth for injected handlers and mixed deployments.
  if (result.accepted && (!result.negotiationHash || !result.providerSig)) {
    throw new Error(
      "quote accepted but provider_sig is missing (wallet sign failed); " +
        "refusing to relay an unsigned offer",
    );
  }

  return result.toDict();
}

/**
 * Verify funded `jobId` carries the quote THIS agent signed.
 *
 * Thin wrapper over `@bnbagent/studio-runtime/erc8183` `verifySignedJob` with
 * `expectedSigner` = our own wallet address. Returns a `Verdict` `{ ok,
 * reason, permanent }`: `ok` → safe to work; otherwise `permanent`
 * distinguishes a job to skip-forever (record + tell the client) from a
 * transient retry.
 */
export async function verifySignedJob(
  jobId: number,
  minimumRemainingSeconds = 0,
): Promise<Verdict> {
  return verifySignedJobCore(jobId, getWallet().address, {
    minimumRemainingSeconds,
  });
}

/**
 * Return the on-chain `JobDescription` for `jobId` (`null` if unstructured).
 *
 * The task + terms the buyer ANCHORED ON-CHAIN — and that this agent's
 * `provider_sig` covers — are the authoritative work spec. The work hook
 * reads the task from HERE (the on-chain job description), so the Agent
 * delivers exactly the deal it signed.
 * Returns `null` for legacy/plain-text descriptions (caller falls back).
 */
export async function jobSpec(jobId: number): Promise<JobDescription | null> {
  const client = await get8183Client();
  const job = await client.getJob(BigInt(jobId));
  return JobDescription.fromStr(job.description);
}

/**
 * Sign + broadcast the on-chain `submit` for `jobId`.
 *
 * Delegates to `@bnbagent/studio-runtime/erc8183` `submitWorkflow`, which
 * re-verifies the job is genuinely FUNDED + assigned to us (via the SDK's
 * `ERC8183JobOps.verifyJob`), builds the `DeliverableManifest`, uploads it
 * to storage, and calls on-chain `submit` — all `auditedOp`-wrapped.
 * Returns the `SubmitResult` (`.submitTx` + `.deliverableUrl`);
 * `deliverableUrl` is published on-chain by the submit, so the buyer fetches
 * the canonical manifest from storage without an on-chain log scan.
 */
export async function submitResult(
  jobId: number,
  responseContent: string,
  metadata?: Record<string, unknown> | null,
): Promise<SubmitResult> {
  return submitWorkflow(jobId, responseContent, { metadata: metadata ?? null });
}

/**
 * Sign + broadcast `settle` (claim payment) for `jobId`.
 *
 * Delegates to `@bnbagent/studio-runtime/erc8183` `settleWorkflow` with the
 * default `approve` action → SDK `router.settle(jobId)`, `auditedOp`-wrapped.
 * Returns the settle tx hash.
 */
export async function settle(jobId: number): Promise<string> {
  return settleWorkflow(jobId, { action: "approve" });
}
