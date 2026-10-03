/**
 * A2A executor — the seller agent's outward A2A surface (two fixed-code
 * skills).
 *
 * The agent serves A2A directly (an `@a2a-js/sdk` express app on the
 * AgentCore A2A runtime contract). This module is ONLY the a2a wire:
 * {@link SellerAgentExecutor} inherits all of the seller logic +
 * background-delivery machinery from `sellerCore.ts` `SellerCore` (which
 * imports nothing from `@a2a-js/sdk`) and adds the a2a-specific
 * {@link SellerAgentExecutor.execute} / {@link SellerAgentExecutor.cancelTask}
 * entrypoints plus the request/response wire helpers. `execute` reads the
 * inbound message's data part and dispatches on its `skill`:
 *
 *     negotiate     → `SellerCore.negotiate` (rule-based price clamp + EIP-191 sign)
 *     notify_funded → `SellerCore.notifyFunded` (fast on-chain gate) → ACK at
 *                     once, then in the BACKGROUND: LLM work → `signing.submitResult`
 *
 * `notify_funded` is the buyer's "I funded job X — please deliver"
 * notification. Because the work takes time, the executor does NOT block the
 * caller: the core verifies the funded job synchronously (a couple of
 * eth_calls) to ACK accepted/rejected, then runs the slow LLM work + on-chain
 * `submit` in a background task and replies immediately. The buyer reads the
 * deliverable back from the CHAIN (SUBMITTED / `getDeliverableUrl`) — the
 * chain is the source of truth. While any background delivery is in flight
 * `isBusy` (from `SellerCore`) reports busy, which `main.ts` feeds to
 * AgentCore's `/ping` as `HEALTHY_BUSY` so the scale-to-zero runtime stays
 * warm until the work lands (within the session max-lifetime).
 *
 * ALL signing is FIXED code in `signing.ts` — NEVER an LLM-callable tool
 * (money is never in the LLM; the LLM only produces the work text, via the
 * `runWork` hook). See `sellerCore.ts` for the negotiate / notifyFunded /
 * sweep logic.
 *
 * You own this file — specialise the work hook / dispatch in `sellerCore.ts`,
 * but keep signing OUT of the LLM tool list.
 */

import { randomUUID } from "node:crypto";
import type { DataPart, Message } from "@a2a-js/sdk";
import {
  A2AError,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import { isCommerceRateLimitError } from "./requestLimits.js";
import { SellerCore } from "./sellerCore.js";

const log = {
  error: (msg: string, e?: unknown) =>
    console.error(`[seller-agent.a2a] ERROR ${msg}`, e ?? ""),
};

/**
 * ERC-8183 seller A2A executor: the a2a wire over `SellerCore`.
 *
 * All seller logic (negotiate, notifyFunded, background delivery, `isBusy`,
 * the constructor bookkeeping, the `runWork` hook) lives in
 * `sellerCore.ts` `SellerCore`; this class adds only the A2A entrypoints and
 * request/response wire helpers.
 *
 * The agent exposes ONLY the two paid, structured skills — there is no
 * free-form chat skill. A plain text message (no `{"skill": ...}` DataPart)
 * is rejected: negotiate / notify_funded always need a structured DataPart,
 * so prose never triggers an LLM call or a paid action.
 */
export class SellerAgentExecutor extends SellerCore implements AgentExecutor {
  /**
   * Text-carrier entrypoint (Foundry invocations / responses SkillRouter).
   *
   * Same skill switch as {@link execute}, but NEVER throws: on a text
   * carrier there is no JSON-RPC error channel, so a fault is returned as an
   * `{"error": ...}` dict and the caller can always reply. The A2A path
   * keeps its own switch below because its fault semantics differ (faults
   * become JSON-RPC -32603 via A2AError).
   */
  async dispatch(
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const skill = data.skill;
    try {
      if (skill === "negotiate") {
        return await this.negotiate(data);
      }
      if (skill === "notify_funded") {
        return await this.notifyFunded(data);
      }
      // Includes a plain text message (no skill envelope → skill is
      // undefined): the seller has no free-form skill, so prose is rejected
      // here.
      return {
        error: `unknown skill: ${JSON.stringify(skill)}`,
        skills: this.skills(),
      };
    } catch (e) {
      // a skill failure must still ACK the buyer
      log.error(`skill ${JSON.stringify(skill)} failed`, e);
      if (isCommerceRateLimitError(e)) {
        return { status: "retry", error: "seller rate limit exceeded", skill };
      }
      return { error: "seller operation failed; retry later", skill };
    }
  }

  // ── A2A entrypoints ───────────────────────────────────────────────────────
  execute = async (
    context: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> => {
    const data = inbound(context);
    const skill = data.skill;
    let result: Record<string, unknown>;
    try {
      if (skill === "negotiate") {
        result = await this.negotiate(data);
      } else if (skill === "notify_funded") {
        result = await this.notifyFunded(data);
      } else {
        // Includes a plain text message (no DataPart → skill is undefined):
        // the seller has no free-form skill, so prose is rejected here.
        result = {
          error: `unknown skill: ${JSON.stringify(skill)}`,
          skills: this.skills(),
        };
        if (skill === undefined) {
          // Most common cause: the caller put the JSON envelope in a
          // "text" part. Structured skill calls must ride in a DataPart.
          result.hint =
            'send the skill envelope as an A2A data part: parts:[{"kind":"data","data":{"skill":"negotiate",...}}]';
        }
      }
    } catch (e) {
      // A genuine internal fault is surfaced as a JSON-RPC error, NOT masked
      // as a successful result. Throwing `A2AError.internalError` is caught
      // by @a2a-js/sdk's request handler and serialized to a proper -32603
      // carrying the request id. CLASSIFIED business outcomes are
      // returned as a result above (peer of the MCP runtime: faults →
      // isError, business outcomes → result).
      log.error(`skill ${JSON.stringify(skill)} failed`, e);
      if (isCommerceRateLimitError(e)) {
        result = {
          status: "retry",
          error: "seller rate limit exceeded",
          skill,
        };
      } else {
        throw A2AError.internalError("seller operation failed; retry later");
      }
    }
    reply(eventBus, context, result);
  };

  cancelTask = async (
    _taskId: string,
    _eventBus: ExecutionEventBus,
  ): Promise<void> => {
    // negotiate is synchronous; notify_funded acks then delivers on-chain in
    // the background — once submitted it is anchored on-chain and cannot be
    // cancelled via A2A. Nothing to cancel here. (@a2a-js/sdk hands cancel
    // only a taskId — no message to reply to — so this surfaces as the
    // standard JSON-RPC unsupported-operation error.)
    throw A2AError.unsupportedOperation("cancel");
  };
}

// ── wire helpers ──────────────────────────────────────────────────────────────

function inbound(context: RequestContext): Record<string, unknown> {
  const parts = context.userMessage?.parts ?? [];
  const dataPart = parts.find((p): p is DataPart => p.kind === "data");
  return dataPart?.data ?? {};
}

function reply(
  eventBus: ExecutionEventBus,
  context: RequestContext,
  data: Record<string, unknown>,
): void {
  const message: Message = {
    kind: "message",
    role: "agent",
    messageId: randomUUID(),
    parts: [{ kind: "data", data }],
    contextId: context.contextId,
    taskId: context.taskId,
  };
  // publish + finished() — without finished() the event stream never closes
  // and the caller hangs.
  eventBus.publish(message);
  eventBus.finished();
}
