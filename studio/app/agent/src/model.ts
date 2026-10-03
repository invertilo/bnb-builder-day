/**
 * Model factory — emitted user code shared by every runtime entrypoint.
 *
 * This file is **your project's code**, scaffolded by `bag` and emitted at
 * `src/model.ts` for every project, whatever `[llm].provider` you chose.
 * It is yours to edit, fork, or replace — studio will not silently rewrite
 * it.
 *
 * What it does:
 *
 * - Exposes {@link buildModel}, the factory called by the sibling entrypoint
 *   to construct the right AI SDK `LanguageModel` for the project's `[llm]`
 *   config. For every provider it resolves a plain model via
 *   `@bnbagent/studio-runtime/llm` `resolveModel`; for `pieverse-llm` (with
 *   auto-renew on) it additionally wraps it with a credit-ensure middleware.
 * - The middleware awaits a Pieverse credit-ensure hook before every
 *   generate/stream call — inert unless the provider is `pieverse-llm`.
 *
 * The credit-refresh / auto-allocate / auto-topup logic itself lives in the
 * library at `@bnbagent/studio-runtime/pieverse` `PieverseCreditEnsurer` —
 * this shell just wires it into the AI SDK's generate-call path (via
 * `wrapLanguageModel`, the AI SDK's sanctioned middleware seam). That keeps
 * the adapter tiny: you can fork *this file* (e.g. to swap the AI SDK for
 * another stack) without forking studio itself.
 *
 * That top-up is the ONLY automatic signing path outside signing.ts — it is
 * budget-gated and is NOT an LLM tool. It rides transparently into the
 * `notify_funded` work step.
 */

import { loadStudioToml, type TomlTable } from "@bnbagent/studio-runtime/config";
import { resolveModel } from "@bnbagent/studio-runtime/llm";
import {
  BudgetPolicy,
  PieverseCreditEnsurer,
  PieversePolicy,
} from "@bnbagent/studio-runtime/pieverse";
import { getWallet } from "@bnbagent/studio-runtime/wallet";
import {
  type LanguageModel,
  type LanguageModelMiddleware,
  wrapLanguageModel,
} from "ai";

/**
 * Build the AI SDK model object for this project's `[llm]` config.
 *
 * Called by the sibling entrypoint. Reads `studio.toml` via
 * `loadStudioToml`, resolves the provider via
 * `@bnbagent/studio-runtime/llm` `resolveModel`, and (when the provider is
 * `pieverse-llm` and auto-renew is enabled) wraps it with the credit-ensure
 * middleware.
 *
 * For non-Pieverse providers — or when `[llm.auto_renew].enabled = false` —
 * returns the raw inner model unwrapped.
 */
export function buildModel(): LanguageModel {
  const cfg = loadStudioToml();
  const llmCfg = (cfg.llm ?? {}) as TomlTable;
  if (String(llmCfg.provider ?? "openrouter") === "none") {
    throw new Error(
      "Protocol-only scaffold: no LLM provider is configured. " +
        "Implement the generated work hook before accepting funded jobs, " +
        "or set [llm].provider and [llm].model in studio.toml.",
    );
  }
  const inner = resolveModel(llmCfg);

  if (String(llmCfg.provider ?? "openrouter") !== "pieverse-llm") {
    return inner;
  }

  // Pieverse path — wrap with the credit-ensure middleware unless auto-renew
  // opted out.
  const autoRenewCfg = (llmCfg.auto_renew ?? {}) as TomlTable;
  const pieverseCfg = (llmCfg.pieverse ?? {}) as TomlTable;
  const budgetCfg = (cfg.budget ?? {}) as TomlTable;

  const policy = PieversePolicy.fromToml(autoRenewCfg);
  if (!policy.enabled) {
    return inner;
  }

  const keyHash = pieverseCfg.key_hash;
  if (!keyHash) {
    throw new Error(
      "[llm.pieverse].key_hash is missing in studio.toml. " +
        "Run `bag llm activate` to create a Pieverse key first. " +
        "(After activate, you may need to restart the agent process " +
        "for changes to take effect.)",
    );
  }
  const networkName = String(pieverseCfg.network ?? "bsc-mainnet");
  const budgetPolicy = BudgetPolicy.fromToml(budgetCfg);

  const ensurer = new PieverseCreditEnsurer({
    modelId: String(llmCfg.model ?? ""),
    wallet: getWallet(),
    keyHash: String(keyHash),
    networkName,
    policy,
    budgetPolicy,
  });

  // The AI SDK middleware seam: ensure credits BEFORE each generate/stream
  // call, then delegate untouched through the AI SDK middleware seam.
  const creditEnsure: LanguageModelMiddleware = {
    wrapGenerate: async ({ doGenerate }) => {
      await ensurer.ensureCredits();
      return doGenerate();
    },
    wrapStream: async ({ doStream }) => {
      await ensurer.ensureCredits();
      return doStream();
    },
  };

  // resolveModel always returns a provider model object (never a bare model
  // id string), so it satisfies wrapLanguageModel's model parameter.
  return wrapLanguageModel({
    model: inner as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: creditEnsure,
  });
}
