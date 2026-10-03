/**
 * Seller core — the a2a-free seller logic + background delivery machinery.
 *
 * This is the protocol-neutral heart of the ERC-8183 seller: the two fixed-code
 * operations (`negotiate` → signed quote; `notifyFunded` → verify → ACK →
 * deliver in the background) plus the background-delivery bookkeeping
 * (`isBusy`, the spawn/run/sweep helpers). It imports NOTHING from
 * `@a2a-js/sdk` so it can back any transport — the A2A executor
 * (`executor.ts`) inherits it and wraps it with the a2a wire, and a non-A2A
 * HTTP entrypoint can call it directly without dragging in the a2a sdk.
 *
 *     negotiate    → `signing.signQuote` (rule-based price clamp + EIP-191 sign)
 *     notifyFunded → `signing.verifySignedJob` (fast on-chain gate) → ACK at
 *                    once, then in the BACKGROUND: LLM work → `signing.submitResult`
 *
 * `notifyFunded` is the buyer's "I funded job X — please deliver" notification.
 * Because the work takes time, it does NOT block the caller: it verifies the
 * funded job synchronously (a couple of eth_calls) to ACK accepted/rejected,
 * then runs the slow LLM work + on-chain `submit` in a background task and
 * returns immediately. The buyer reads the deliverable back from the CHAIN
 * (SUBMITTED / `getDeliverableUrl`) — the chain is the source of truth. While
 * any background delivery is in flight {@link SellerCore.isBusy} reports busy,
 * which the transport feeds to AgentCore's `/ping` as `HEALTHY_BUSY` so the
 * scale-to-zero runtime stays warm until the work lands (within the session
 * max-lifetime).
 *
 * ALL signing is FIXED code in `signing.ts` — NEVER an LLM-callable tool
 * (money is never in the LLM; the LLM only produces the work text, via the
 * `runWork` hook). On each notification the core also opportunistically sweeps
 * OTHER funded jobs assigned to this provider — the buyer-push fallback for
 * jobs whose buyer funded on-chain but never sent `notify_funded` (deduped
 * against in-flight jobs). Negotiate stays sweep-free so quotes are fast. A
 * periodic Lambda poller — which also covers the scale-to-zero cold window
 * when no one is invoking — is the v2 robust path.
 *
 * You own this file — specialise the work hook / dispatch, but keep signing
 * OUT of the LLM tool list.
 */

import { ERC8183JobOps } from "@bnbagent/sdk/erc8183";
import { maskUrlSecrets } from "@bnbagent/studio-runtime/audit";
import { SubmitPermanentlyUnsupportedError } from "@bnbagent/studio-runtime/erc8183";
import { getWallet } from "@bnbagent/studio-runtime/wallet";
import {
  DeliveryTimeoutError,
  deliveryTimeoutSeconds,
  envSeconds,
  minimumDeliveryWindowSeconds,
  withTimeout,
} from "./deliveryPolicy.js";
import { limitCommerceOperation } from "./requestLimits.js";
import * as defaultSigning from "./signing.js";

function safeLogText(value: unknown): string {
  const text =
    value instanceof Error
      ? (value.stack ?? `${value.name}: ${value.message}`)
      : String(value ?? "");
  return maskUrlSecrets(text);
}

const log = {
  info: (msg: string) => console.log(`[seller-agent.core] ${safeLogText(msg)}`),
  warn: (msg: string) =>
    console.warn(`[seller-agent.core] WARNING ${safeLogText(msg)}`),
  error: (msg: string, e?: unknown) =>
    console.error(
      `[seller-agent.core] ERROR ${safeLogText(msg)}`,
      safeLogText(e),
    ),
};

// Background-task ceilings. notifyFunded ACKs immediately and delivers in a
// BACKGROUND task; AgentCore keeps the scale-to-zero microVM warm
// (HEALTHY_BUSY) while isBusy() is true. A delivery (LLM text + on-chain
// submit + IPFS pin) normally finishes in ~1-2 min, so these caps sit far
// above real work and only fire on a HANG (e.g. an unresponsive RPC) —
// without them a hung task keeps the VM pinned to its 8h max-lifetime,
// billing memory the whole time. A timed-out job is treated as TRANSIENT
// (not dropped): the funded job stays on-chain and a later sweep re-delivers
// it idempotently. (Read lazily so tests can tune them via the env.)
const sweepTimeoutSeconds = () => envSeconds("NOTIFY_SWEEP_TIMEOUT_SECONDS", 60);
const preverifyTimeoutSeconds = () =>
  envSeconds("NOTIFY_PREVERIFY_TIMEOUT_SECONDS", 30);

/**
 * The LLM work hook: produce the deliverable text for a prompt.
 *
 * Built in `main.ts` from the AI SDK (`generateText` + the read-only chain
 * tools); called by verified ERC-8183 delivery and, through the runtime
 * adapter, by x402 only after its commerce gate. `abortSignal` is wired to
 * the delivery timeout so a hung LLM call is actually cancelled.
 */
export type RunWork = (
  prompt: string,
  opts: { sessionId: string; abortSignal?: AbortSignal },
) => Promise<string>;

/** The `signing.ts` surface the core drives (injectable for tests). */
export interface SigningApi {
  listPrice(): bigint;
  clampPrice(proposedWei: bigint): bigint;
  signQuote(
    request: Record<string, unknown>,
    clampedPriceWei?: bigint,
  ): Promise<Record<string, unknown>>;
  verifySignedJob(
    jobId: number,
    minimumRemainingSeconds?: number,
  ): Promise<{ ok: boolean; reason: string; permanent: boolean }>;
  jobSpec(
    jobId: number,
  ): Promise<{ task: string; terms: Record<string, unknown> } | null>;
  submitResult(
    jobId: number,
    responseContent: string,
    metadata?: Record<string, unknown> | null,
  ): Promise<{ submitTx: string; deliverableUrl: string | null }>;
}

/** Pending-job scanner used by the sweep (injectable for tests). */
export type PendingJobsFetcher = (
  network: string,
) => Promise<Record<string, unknown>>;

const defaultPendingJobs: PendingJobsFetcher = async (network) => {
  const ops = await ERC8183JobOps.create({
    walletProvider: getWallet(),
    network,
  });
  return (await ops.getPendingJobs()) as Record<string, unknown>;
};

export interface SellerCoreOpts {
  runWork: RunWork;
  generator: string;
  network?: string | null;
  /** Whether the project configured the ERC-8183 commerce rail. */
  commerceSkills?: boolean;
  /** Test seam: replace the signing module (default: `./signing.js`). */
  signing?: SigningApi;
  /** Test seam: replace the sweep's pending-job scan. */
  pendingJobs?: PendingJobsFetcher;
}

/**
 * ERC-8183 seller core: negotiate + notifyFunded, backed by signing.ts.
 *
 * `runWork(prompt, { sessionId })` is the LLM work hook (built in `main.ts`
 * from the AI SDK); it is called inside the background delivery
 * (`notifyFunded` → `doWorkAndSubmit`) to produce the deliverable text.
 *
 * The core exposes ONLY the two paid, structured operations — there is no
 * free-form chat operation. The transport is responsible for routing a
 * request to {@link negotiate} / {@link notifyFunded}; a request that names
 * no structured operation must never trigger an LLM call or a paid action.
 */
export class SellerCore {
  protected readonly runWork: RunWork;
  protected readonly generator: string;
  protected readonly network: string;
  protected readonly signing: SigningApi;
  private readonly commerceSkills: boolean;
  private readonly pendingJobs: PendingJobsFetcher;
  // Background delivery bookkeeping (see notifyFunded / isBusy):
  //  tasks    — live background promises (busy-status source).
  //  inflight — job ids in flight OR already terminally handled this
  //             process (notify/sweep dedup; retained on success so a
  //             slower sweep never re-delivers a just-submitted job).
  private readonly tasks = new Set<Promise<void>>();
  private readonly inflight = new Set<number>();

  constructor(opts: SellerCoreOpts) {
    this.runWork = opts.runWork;
    this.generator = opts.generator;
    this.network = opts.network ?? "bsc-testnet";
    this.signing = opts.signing ?? defaultSigning;
    this.commerceSkills = opts.commerceSkills ?? true;
    this.pendingJobs = opts.pendingJobs ?? defaultPendingJobs;
  }

  /**
   * True while any background delivery is in flight.
   *
   * The transport feeds this to AgentCore's `/ping` (`HEALTHY_BUSY` when
   * busy) so the scale-to-zero runtime is not reaped on idle while work runs.
   */
  isBusy(): boolean {
    return this.tasks.size > 0;
  }

  /** Await every in-flight background task (test helper — not on the wire). */
  async drain(): Promise<void> {
    while (this.tasks.size > 0) {
      await Promise.allSettled([...this.tasks]);
    }
  }

  // ── skills ──────────────────────────────────────────────────────────────

  /**
   * Rule-based quote → SDK `NegotiationResult` envelope (no LLM).
   *
   * The price is FIXED by studio.toml and resolved inside `signQuote`, which
   * owns the canonical-vs-legacy distinction: canonical `[payments.seller]`
   * converts one `price_usd` into each asset's atomic amount, legacy
   * `[payments.erc8183]` clamps its single price to `[min,max]` BEFORE
   * signing. Either way a misconfigured or hostile request can never sign out
   * of bounds. The buyer parses this envelope verbatim and anchors it on-chain
   * via `createJob` + `fund`.
   */
  async negotiate(
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.requireCommerceRail();
    await limitCommerceOperation("negotiate");
    let request = data.request;
    if (request === null || typeof request !== "object" || Array.isArray(request)) {
      const picked: Record<string, unknown> = {};
      for (const k of ["task_description", "terms"]) {
        if (k in data) picked[k] = data[k];
      }
      request = picked;
    }
    return this.signing.signQuote(request as Record<string, unknown>);
  }

  /** The seller's two advertised skills. */
  skills(): string[] {
    return this.commerceSkills ? ["negotiate", "notify_funded"] : [];
  }

  /**
   * Buyer notification: "I funded job X — please deliver."
   *
   * Verify the funded job synchronously (a couple of eth_calls) to ACK
   * accepted/rejected at once, then run the slow LLM work + on-chain
   * `submit` in a BACKGROUND task and return IMMEDIATELY. The buyer reads
   * the deliverable back from the CHAIN (SUBMITTED / `getDeliverableUrl`) —
   * the chain is the source of truth (see erc8183-buyer-push.md).
   *
   * An accepted notification also kicks a background sweep (deduped against
   * in-flight jobs), so a buyer that funded but forgot to notify is still
   * served while we're warm. A rejected / malformed notification spawns
   * nothing.
   */
  async notifyFunded(
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.requireCommerceRail();
    await limitCommerceOperation("notify_funded");
    const raw = data.job_id;
    if (raw === undefined || raw === null || String(raw) === "") {
      this.spawn(() => this.sweep()); // bare notify → just scan stragglers
      return {
        status: "accepted",
        note: "no job_id — scanning funded jobs in the background; poll the chain for results",
      };
    }
    let jobId: number;
    try {
      jobId = parseJobId(raw);
    } catch {
      return { status: "rejected", error: `invalid job_id: ${JSON.stringify(raw)}` };
    }
    let verified = false;
    try {
      // Time-bounded: a hung RPC must not stall the ack path. On timeout we
      // fall through to accept-and-re-verify below.
      const v = await withTimeout(
        this.signing.verifySignedJob(jobId, minimumDeliveryWindowSeconds()),
        preverifyTimeoutSeconds(),
      );
      if (!v.ok && v.permanent) {
        return { status: "rejected", job_id: jobId, reason: v.reason };
      }
      verified = v.ok;
    } catch (e) {
      // pre-verify is best-effort; the background delivery re-verifies
      log.warn(
        `pre-verify of job ${jobId} failed (${e instanceof Error ? e.message : e}); accepting, will re-verify in background`,
      );
    }
    this.spawnJob(jobId, { verified });
    this.spawn(() => this.sweep()); // straggler fallback alongside the named job
    return {
      status: "accepted",
      job_id: jobId,
      note: "delivery started; poll the chain (SUBMITTED / get_deliverable_url) for the result",
    };
  }

  // ── background delivery ──────────────────────────────────────────────────

  /** Run `work` as a tracked background task (keeps {@link isBusy} true). */
  protected spawn(work: () => Promise<void>): void {
    const task = work().catch((e) => {
      // a background task must never crash the process
      log.error("background task failed", e);
    });
    this.tasks.add(task);
    task.finally(() => this.tasks.delete(task));
  }

  /**
   * Background-deliver `jobId` once, deduped against in-flight jobs.
   *
   * `inflight` is updated SYNCHRONOUSLY here (before scheduling) so a
   * concurrent notify + sweep can never double-deliver the same job.
   */
  private spawnJob(jobId: number, opts: { verified: boolean }): void {
    if (this.inflight.has(jobId)) return;
    this.inflight.add(jobId);
    this.spawn(() => this.runJob(jobId, opts));
  }

  /**
   * Background runner: deliver one job, log the outcome, free the slot.
   *
   * `verified` jobs (pre-verified in `notifyFunded`) skip straight to the
   * work; unverified ones (the sweep) run the full verify gate first.
   */
  private async runJob(
    jobId: number,
    { verified }: { verified: boolean },
  ): Promise<void> {
    let terminal = false;
    const controller = new AbortController();
    try {
      // Hard ceiling so a hung delivery (e.g. unresponsive RPC) cannot keep
      // isBusy() true — which would pin the microVM to its 8h max-lifetime.
      // A timeout is TRANSIENT: terminal stays false, the slot is freed, and
      // the funded job is re-delivered idempotently by a later sweep.
      const result = await withTimeout(
        verified
          ? this.doWorkAndSubmit(jobId, controller.signal)
          : this.fulfillJob(jobId, controller.signal),
        deliveryTimeoutSeconds(),
        controller,
      );
      log.info(`notify_funded job ${jobId} → ${JSON.stringify(result)}`);
      // A terminal outcome (delivered, or a permanent skip) must STAY in
      // `inflight`: keeping it lets the dedup gate in spawnJob reject a
      // slower concurrent sweep that still sees this job as FUNDED, so the
      // just-submitted job is never re-delivered. Clearing on success
      // reopened that race — the sweep re-ran the work and then failed the
      // on-chain FUNDED gate (Job status is SUBMITTED). Only transient
      // failures fall through to delete so a later sweep can retry them.
      terminal = Boolean(result.ok || result.skip);
    } catch (e) {
      if (e instanceof DeliveryTimeoutError) {
        // Transient by design — leave terminal false so a later sweep retries.
        log.warn(
          `background delivery of job ${jobId} timed out after ${deliveryTimeoutSeconds()}s; will retry`,
        );
      } else {
        log.error(`background delivery of job ${jobId} failed`, e);
      }
    } finally {
      if (!terminal) {
        this.inflight.delete(jobId);
      }
    }
  }

  private requireCommerceRail(): void {
    if (!this.commerceSkills) {
      throw new Error("8183 rail disabled");
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * Verify the signed deal on-chain, then deliver (the sweep's per-job worker).
   *
   * VERIFY before working: confirm the funded job carries the exact quote
   * THIS agent signed (ecrecover + budget ≥ price). A permanent failure
   * (not our signature, tampered terms, underfunded, expired) returns
   * `skip: true`; a transient one returns `ok: false` to retry.
   */
  private async fulfillJob(
    jobId: number,
    abortSignal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const v = await this.signing.verifySignedJob(
      jobId,
      minimumDeliveryWindowSeconds(),
    );
    if (!v.ok) {
      return { ok: false, job_id: jobId, skip: v.permanent, reason: v.reason };
    }
    return this.doWorkAndSubmit(jobId, abortSignal);
  }

  /**
   * LLM work → sign + submit. Assumes `jobId` is already verified.
   *
   * DEVELOPER HOOK: the LLM block produces the deliverable text — specialise
   * it for your seller. `signing.submitResult` re-runs the SDK `verifyJob`
   * (defense in depth) and THROWS on a failed submit, so an `ok: true`
   * result always carries a landed tx hash.
   */
  protected async doWorkAndSubmit(
    jobId: number,
    abortSignal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const spec = await this.signing.jobSpec(jobId);
    const task =
      spec !== null
        ? JSON.stringify({ task: spec.task, terms: spec.terms })
        : `job ${jobId}`;
    const prompt =
      "You accepted and were paid for the following job. Produce the " +
      "deliverable now. Be complete and self-contained.\n\n" +
      `JOB CONTEXT:\n${task}`;
    const work = await this.runWork(prompt, {
      sessionId: String(jobId),
      abortSignal,
    });

    let res: { submitTx: string; deliverableUrl: string | null };
    try {
      res = await this.signing.submitResult(jobId, work, {
        job_id: jobId,
        generator: this.generator,
        built_with: "https://github.com/bnb-chain/bnbagent-studio",
      });
    } catch (e) {
      if (
        e instanceof SubmitPermanentlyUnsupportedError ||
        (e instanceof Error && e.name === "SubmitPermanentlyUnsupportedError")
      ) {
        // Deterministic for this wallet kind: submit can NEVER succeed →
        // permanent skip (a transient error would burn one LLM call / retry).
        return { ok: false, job_id: jobId, skip: true, reason: e.message };
      }
      throw e;
    }
    return {
      ok: true,
      job_id: jobId,
      tx_hash: res.submitTx,
      deliverable_url: res.deliverableUrl,
    };
  }

  /**
   * Best-effort background fallback: deliver any FUNDED jobs for this
   * provider.
   *
   * Catches jobs whose buyer funded on-chain but never sent `notify_funded`.
   * Each job is handed to `spawnJob` (deduped against in-flight jobs, so a
   * concurrent notify never double-delivers); `verifySignedJob` returns
   * non-OK for an already-SUBMITTED job (idempotent, no state file). Errors
   * here are logged and never surface to the caller.
   */
  private async sweep(): Promise<void> {
    let pending: Record<string, unknown>;
    try {
      // Time-bounded: a hung scan would otherwise keep isBusy() true (it
      // runs on every notify) and pin the microVM to its 8h max-lifetime.
      pending = await withTimeout(
        this.pendingJobs(this.network),
        sweepTimeoutSeconds(),
      );
    } catch (e) {
      // the sweep is best-effort (incl. timeouts)
      log.warn(`funded-job sweep failed: ${e instanceof Error ? e.message : e}`);
      return;
    }
    const jobs = Array.isArray(pending?.jobs) ? pending.jobs : [];
    for (const job of jobs) {
      const jid =
        job !== null && typeof job === "object" && !Array.isArray(job)
          ? (job as Record<string, unknown>).jobId
          : undefined;
      if (jid === undefined || jid === null) continue;
      try {
        this.spawnJob(parseJobId(jid), { verified: false });
      } catch {
        // unparseable id — skip
      }
    }
  }
}

/** Normalise an envelope `job_id` (`0x..` / decimal string / number) to int. */
export function parseJobId(raw: unknown): number {
  if (typeof raw === "number" && Number.isInteger(raw)) return raw;
  if (typeof raw === "bigint") return Number(raw);
  // BigInt() parses both `0x..` hex and decimal strings, and throws on junk.
  return Number(BigInt(String(raw).trim()));
}
