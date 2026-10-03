# PrimeraAccion — A2A + X402 seller agent (managed-platform trial)

The valuable Agent and the **SOLE key-holder/signer** for the PrimeraAccion seller,
configured for the **BNB Chain managed platform** (`[deploy].destination =
"platform"`) — a 48h **testnet-only** trial sandbox. It serves the SAME
A2A + X402 surface as a self-deploy (`serveA2a`: the agent card at `/.well-known/agent-card.json` + JSON-RPC `message/send` on `0.0.0.0:9000`); every signing op is fixed
entrypoint code in `src/signing.ts` — never an LLM-callable tool.

## What's here

- `src/unifiedMain.ts` — unified serving entrypoint (A2A on port 9000 + Foundry invocations on 8088).
- `src/executor.ts` — the SellerAgentExecutor: the negotiate + notify_funded A2A skills.
- `src/agentCard.ts` — the discoverable AgentCard (+ OAuth2/Cognito scheme).
- `src/signing.ts` — protocol-neutral signing entrypoints. ALL on-chain writes
  go through these functions — never an LLM-callable tool.
- `src/model.ts` — provider adapter (e.g. the Pieverse managed model with
  budget-gated LLM-credit auto-renew).
- `src/tools.ts` — read-only chain tools.
- `studio.toml` — Agent's own config (wallet, LLM, canonical seller USD price,
  assets, and budget).
- the wallet key material lives OUTSIDE this sub-project so deploy packaging can
  never bundle it: an evm-local keystore at the WORKSPACE root `.studio/wallets/`,
  or the twak mnemonic in the project's twak home (gitignored either way).
- `.env.local` — Agent secrets; on deploy they are sent to the **operator's**
  Secrets Manager (the scoped, consented commitment-#2 exception). Use a
  THROWAWAY testnet wallet — `(cd app/agent && bag wallet new)`.

## Run locally

`bag dev` from the workspace root runs the A2A + X402 server in-process
(`tsx src/unifiedMain.ts`, no Docker) on its contract port:

```bash
bag dev                                    # A2A + X402 on http://localhost:9000
```

It auto-loads `.studio/.env.local` — no need to `source` it.

## Deploy (managed platform — 48h testnet trial)

```bash
bag platform login                         # GitHub login (~/.bnbagent-deploy/bnb/session.json) + supported-wallet testnet faucet
# From the workspace root:
bag deploy --provider bnb                  # explicit 48h trial provider
```

The platform injects your secrets into the **operator's** Secrets Manager and
routes to the agent's native A2A + X402 surface. The trial is testnet-forced and
auto-reclaimed at 48h. Account/session ops live under
`bag platform {login,logout,whoami,agents,credit}`.
