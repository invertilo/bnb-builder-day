# Primera Acción en BNB Agent Studio

Primera Acción tiene dos caras que comparten el mismo código:

| Cara | Para quién | Dónde corre | Red | Qué hace |
|---|---|---|---|---|
| **Bot de Telegram** (`src/index.ts`) | Personas | Proceso propio siempre encendido (VPS, Docker o tu máquina) | BSC mainnet | Precios, análisis, compras y ventas con confirmación |
| **Agente de Agent Studio** (`studio/`) | Otros agentes de IA y apps (A2A y x402) | Deploy de Agent Studio | Identidad ERC-8004 en la red del agente | **Análisis pre-compra** de solo lectura: precio en bolsa en tiempo real, precio de cada token, brecha, estado del emisor y cotización sin ejecutar |

¿Por qué separadas? El deploy gestionado de prueba (48 h) es **solo testnet**, apaga procesos inactivos tras 1 minuto y limita las sesiones a 5 minutos, así que no puede alojar un bot de Telegram. Las acciones tokenizadas, en cambio, existen **solo en mainnet**.

## Qué hay en `studio/`

Es el workspace que genera `bag init` (CLI `@bnbagent/studio-cli@0.0.14`), creado **sin wallet ni secretos**:

```bash
bag init PrimeraAccion --no-onboard --no-install --protocols A2A,X402 \
  --seller-price-usd 0 --llm-provider none --network bsc-testnet --destination platform
```

Cambios sobre lo generado:

- `app/agent/src/unifiedMain.ts`: `buildRunWork()` ya no llama a un LLM genérico, sino a nuestro análisis (`createStudioRunWork`, en `src/studio/run-work.ts`).
- `app/agent/studio.toml`: `[payments.b402_seller].enabled = true` con `price_usd = "0"`, o sea, `/x402` **gratis y anónimo** (sin credenciales B402).
- `app/agent/package.json`: agrega `viem`.

El deploy empaqueta solo `app/agent/`, así que nuestro código se copia a `app/agent/src/primera/` con `npm run studio:sync`. Esa carpeta es generada y no se commitea.

## Correrlo local

Requisitos: Node 22+ y Corepack. Para deployar también Bun 1.3+.

```bash
npm install -g @bnbagent/studio-cli      # CLI "bag"
npm run studio:sync                      # desde la raíz del repo
cd studio
corepack pnpm install
(cd app/agent && bag wallet new --generate-password)   # wallet del agente (la crea y guarda la CLI, en .studio/)
bag doctor
bag dev                                  # A2A en :9000 y x402 en :9000/x402
```

Probar la cara x402:

```bash
curl -s -X POST http://localhost:9000/x402 -H 'Content-Type: application/json' -d '{"prompt":"NVDA 25"}'
```

Responde `{"result": "📈 *NVIDIA Corporation* (NVDA)\n🏛️ *En bolsa:* …"}`. El prompt acepta `TICKER MONTO`, `analiza apple` o texto libre (con `LLM_API_KEY`).

Para que el agente use la IA y cotice, agrega en `studio/.studio/.env.local` las mismas variables del bot (`LLM_API_KEY`, `BINANCE_API_KEY`, `BINANCE_API_SECRET`, `AGENT_PRIVATE_KEY`). Sin ellas responde con los datos de mercado, sin análisis de IA ni cotización. `bag dev` lee ese archivo (verificado). Para el deploy, la CLI usa `bag env set`, pero todavía no probamos que esas variables propias lleguen al runtime gestionado.

## Deploy (trial gestionado de 48 h, testnet)

```bash
cd studio
bag platform login                       # login con GitHub (device flow; la cuenta debe tener 30+ días)
(cd app/agent && bag wallet fund)        # tBNB + U de testnet para registrar la identidad
bag deploy --provider bnb
bag deploy verify --provider bnb         # registra / actualiza la identidad ERC-8004
```

- El reloj de 48 h empieza con el primer deploy exitoso y no se reinicia. **Hagan el deploy cerca de la demo.**
- La clave de la wallet se envía al secret store del operador: usen la wallet descartable de `bag wallet new`, nunca la del bot.
- Registro ERC-8004 en testnet: `0x8004A818BFB912233c491871b3d84c89A494BD9e`. Para identidad en mainnet hace falta self-hosting (`--destination self --network bsc-mainnet`).

## Notas para el DX report

- `bag dev` imprime `x402 seller … (PAID — active when B402 credentials are configured)` aunque `bag doctor` dice `FREE — /x402 is anonymous`. Con `price_usd = "0"` funciona gratis.
- El scaffold usa `zod ^3.25` y nuestro código usa zod 4: importamos desde `zod/v4`, que existe en las dos versiones.
- `bag mcp serve` y `bag deploy package` aparecen en la documentación, pero no existen en la CLI 0.0.14.
- `corepack pnpm install` pide confirmación para descargar pnpm; en CI se usa `corepack enable`.
