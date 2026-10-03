#!/usr/bin/env node
/**
 * Copia el código de Primera Acción al agente de BNB Agent Studio (studio/app/agent/src/primera/).
 * El deploy de Agent Studio empaqueta solo app/agent, así que el análisis tiene que vivir ahí.
 * Excluye tests, el bot de Telegram y los scripts locales. Correr antes de `bag dev` o `bag deploy`.
 *
 * Uso: node scripts/studio-sync.mjs [ruta/al/app/agent]
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = resolve(process.argv[2] ?? join(root, "studio", "app", "agent"));
const target = join(agentDir, "src", "primera");

const INCLUDE = ["agent", "binance", "domain", "i18n", "llm", "stocks", "studio", "wallet", "app.ts", "config.ts", "ports.ts", "store.ts", "store-redis.ts"];

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const entry of INCLUDE) {
  cpSync(join(root, "src", entry), join(target, entry), {
    recursive: true,
    filter: (src) => !src.endsWith(".test.ts"),
  });
}
console.log(`Primera Acción copiado a ${relative(process.cwd(), target) || target}`);
