# Integración con BNB Agent Studio

Primera Acción tiene dos caras:

| Cara | Para quién | Dónde corre | Red | Qué hace |
|---|---|---|---|---|
| **Bot de Telegram** (`src/index.ts`) | Personas | Proceso propio siempre encendido (VPS o tu máquina) | BSC mainnet | Precios, análisis, compras y ventas con confirmación |
| **Seller de Agent Studio** (`src/studio/run-work.ts`) | Otros agentes de IA (A2A / x402) | Deploy de Agent Studio | Identidad ERC-8004 en la red del agente | Análisis pre-compra de solo lectura: precio en bolsa, tokens, brecha, estado y cotización sin ejecutar |

¿Por qué separadas? El deploy gestionado de prueba (48 h) es **solo testnet**, apaga procesos inactivos tras 1 minuto y limita sesiones a 5 minutos, así que no puede alojar un bot de Telegram. Las acciones tokenizadas, en cambio, existen **solo en mainnet**.

## 1. Instalar la CLI

```bash
npm install -g @bnbagent/studio-cli
bag skills install          # opcional: skill /bnbagent-studio para Claude Code / Cursor
```

Requisitos: Node 22+, Corepack + pnpm 10, Bun 1.3+ (para deploy).

## 2. Crear el workspace del agente

`bag init` crea una carpeta nueva con su **propia wallet** (keystore cifrado en `.studio/wallets/`) y la contraseña en `.studio/.env.local`. Lo corre una persona del equipo, fuera de este repo:

```bash
bag init PrimeraAccion --protocols A2A,X402 --seller-price-usd 0 --network bsc-testnet
cd PrimeraAccion
bag doctor
```

- El nombre solo admite letras y números (sin guiones).
- `--seller-price-usd 0` lo deja gratis: el endpoint `/x402` queda público y no hace falta configurar B402.
- Para el LLM del seller hay dos opciones: `--llm-provider pieverse-llm` (el agente paga su propio LLM, buen punto para el premio de Agent Studio) o `--llm-provider none` y usar `deepseek-v4-flash` vía AgentRouter desde nuestro código.

## 3. Conectar nuestro análisis al hook `runWork`

En `app/agent/src/sellerCore.ts` (A2A) del workspace generado, reemplaza el cuerpo de `runWork` por una llamada a nuestro análisis. Instala este repo como dependencia (`pnpm add file:<ruta-a-este-repo>`) o copia `src/`, y:

```ts
import { loadConfig } from "primera-accion/dist/config.js";
import { buildApp } from "primera-accion/dist/app.js";
import { createStudioRunWork } from "primera-accion/dist/studio/run-work.js";

const app = buildApp(loadConfig({ ...process.env, TELEGRAM_BOT_TOKEN: "no-usado" }));
const analyze = createStudioRunWork(app);

export const runWork: RunWork = async (prompt) => analyze(prompt);
```

`runWork` es solo lectura: cotiza, pero nunca firma. Si el seller no tiene `BINANCE_API_KEY` / `AGENT_PRIVATE_KEY`, devuelve el análisis sin cotización.

## 4. Probar local y deployar

```bash
bag dev                                   # A2A en :9000
curl -s localhost:9000/.well-known/agent-card.json

bag platform login                        # login con GitHub (device flow)
bag deploy --provider bnb                 # trial gestionado de 48 h, testnet
bag deploy verify --provider bnb          # registra / actualiza la identidad ERC-8004
```

Prueba la cara x402 gratis:

```bash
curl -X POST "<url-del-agente>/x402" -H 'Content-Type: application/json' -d '{"prompt":"NVDA 25"}'
```

## Notas

- Usa una wallet **descartable** para el trial: la clave se guarda en el secret store del operador de la plataforma.
- La identidad ERC-8004 del trial queda en testnet (registro `0x8004A818BFB912233c491871b3d84c89A494BD9e`). Para identidad en mainnet hay que hacer self-hosting (`bag init --destination self --network bsc-mainnet`).
- Docs con partes desactualizadas: `bag mcp serve` y `bag deploy package` aparecen en la documentación, pero no existen en la CLI 0.0.14. Anótenlo en el [DX_LOG](../DX_LOG.md) si les afecta.
