/**
 * Crea una wallet nueva para el agente y guarda la clave en .env (permisos 600).
 * No sobrescribe una clave existente. Solo imprime la dirección pública.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ENV = ".env";
let env = existsSync(ENV) ? readFileSync(ENV, "utf8") : existsSync(".env.example") ? readFileSync(".env.example", "utf8") : "";

const current = env.match(/^AGENT_PRIVATE_KEY=(.*)$/m);
if (current?.[1]?.trim()) {
  console.error("Ya hay una AGENT_PRIVATE_KEY en .env. No la sobrescribo (bórrala a mano si de verdad quieres otra).");
  process.exit(1);
}

const key = generatePrivateKey();
const address = privateKeyToAccount(key).address;
env = current ? env.replace(/^AGENT_PRIVATE_KEY=.*$/m, `AGENT_PRIVATE_KEY=${key}`) : `${env.trimEnd()}\nAGENT_PRIVATE_KEY=${key}\n`;
writeFileSync(ENV, env, { mode: 0o600 });

console.log(`Wallet del agente creada: ${address}

Siguientes pasos:
  1. Guarda una copia de seguridad de AGENT_PRIVATE_KEY (está en .env). Si se pierde, se pierden los fondos.
  2. Envía a esa dirección, en BNB Smart Chain (BEP-20):
       • un poco de BNB para gas (≈ 0.005 BNB alcanza para varias operaciones)
       • USDT para comprar (Ondo pide órdenes de ~20 USD como mínimo)
  3. Corre: npm run check NVDA 25`);
