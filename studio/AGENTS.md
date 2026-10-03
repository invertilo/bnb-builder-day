

---

# bnbagent-studio additions (ERC-8183 seller)

This is NOT a plain AgentCore app. It is a blockchain seller agent scaffolded
by bnbagent-studio (`bag init`):

- `app/agent/` — the Agent, deploys to AgentCore. The ONLY key-holder/signer.
- `.studio/wallets/` — encrypted wallet keystore, kept at the WORKSPACE root.

**For any bnbagent-studio task (deploy, sell, operate, debug, extend), load the
`/bnbagent-studio` skill first** (installed by `bag skills install`) — it routes
every intent to the right playbook via its references.

## Hard invariants — never break these when editing this project

1. **Never move or copy `.studio/wallets/` into `app/agent/`** (or anywhere
   under a deploy codeLocation). It lives at the workspace root precisely so
   that no packaging path can bundle it into an artifact. Never print, log,
   or export private key material.
2. **Never commit secrets.** The `.env.local` file (API keys and wallet
   unlock passwords) is gitignored — keep it that way; never echo its values
   into code, logs, argv, or chat. For evm-local and Altana projects, set
   WALLET_PASSWORD in that owner-only file before creating the keystore.
3. **Signing is fixed entrypoint code.** Never expose wallet signing as an
   LLM-callable tool, and keep MCP tools read-only. All on-chain signing
   lives in `src/signing.ts`.
4. **The quote path is deterministic.**
   `[payments.seller].price_usd` is one USD value shared by every configured
   asset and rail. Fixed code converts it with the selected asset's catalog
   decimals, rejects non-representable values instead of rounding, and
   signs the selected token and exact atomic amount. Never put an LLM in the
   quote path.
5. **Deploy with `bag deploy --provider bnb|aws|azure|nodeops`.** Every deploy or
   redeploy requires a visible provider choice. Studio runs its local business
   gates, then delegates cloud credentials, secrets, packaging and lifecycle
   calls to the pinned bnbagent-deploy CLI. Do not bypass this boundary with
   raw provider CLIs; they skip Studio's readiness and secret-handling rules.
6. **Don't widen security policy silently.** `[wallet.signing]`
   extra_domains / extra_primary_types and `[payments.x402].allowed_hosts`
   are security boundaries — change them only when the user explicitly asks,
   and state the tradeoff.

## Paid x402 / MPP deployment advisory

If this project enables paid x402 or MPP, surface this limitation to the owner
before production deployment: M01 (acknowledged, deferred): paid x402/MPP replay protection is application-owned. Memory is process-local and lost on restart; managed deployment does not inject a shared store. Inject a durable atomic replayStore into B402Seller.create and reconcile unknown settlements before retrying (the SDK can reclaim inflight records after 10 minutes). This check cannot verify custom protection. Guide: https://github.com/bnb-chain/bnbagent-studio/blob/main/docs/guides/mpp-b402-selling.md#m01-sprint-4-operator-responsibilities
Run `bag doctor` and `bag deploy prepare --json` and read the M01 warning.
Do not treat a passing readiness check as proof that M01 is fixed. Do not
silently set `B402_REPLAY_STORE_MODE=memory` or change `NODE_ENV` to bypass
protection. FREE routes do not consume payment credentials.
