# Diario de Developer Experience

> Vale el **25% del puntaje** del hackathon. El jurado rechaza reportes genéricos o generados por IA.
> Anota aquí cada fricción **en el momento** (hora, qué intentabas, qué pasó, cuánto tiempo perdiste).
> Al final, escribe el reporte con tus palabras usando estas notas como evidencia.

## Cómo anotar

```
### 2026-10-03 14:20 — [Agent Studio | RWA API | Trading API | Wallet | Docs | Liquidez]
Intentaba: …
Pasó: … (pega el error exacto)
Esperaba: …
Tiempo perdido: ~15 min
Cómo lo resolví / workaround: …
Sugerencia concreta: …
```

## Secciones que pide el brief (para el reporte final)

1. **Onboarding**: tiempo desde cero hasta el primer agente corriendo y hasta la primera compra onchain.
2. **Errores en la documentación**: links rotos, ejemplos que no compilan, parámetros mal descritos.
3. **Problemas con las APIs**: auth, rate limits, respuestas inesperadas, códigos de error poco claros.
4. **Específico de acciones tokenizadas**: liquidez, slippage real con distintos montos, comportamiento fuera de horario, brecha entre precio onchain y de referencia, diferencias entre bStocks, Ondo y xStocks.
5. **Stack de IA**: Agent Studio, Agentic Wallet / Wallet Skills, pago de LLM, ERC-8004.
6. **Feature requests y rediseños**: qué cambiarías y por qué.

## Medidas para registrar (llénalas con datos reales)

| Ticker | Emisor | Monto USDT | Slippage cotizado | Slippage real | Precio onchain | Precio ref. | Brecha | ¿Bolsa abierta? | Fecha/hora |
|--------|--------|-----------:|------------------:|--------------:|---------------:|------------:|-------:|-----------------|------------|
|        |        |            |                   |               |                |             |        |                 |            |

## Entradas

<!-- Agrega entradas abajo, la más nueva al final -->

## Hallazgos técnicos del 3 de octubre (verifíquenlos y escríbanlos con sus palabras)

Notas crudas de la investigación de docs y paquetes. Son evidencia para el reporte, no el reporte. Confirmen cada una antes de usarla.

**Binance Web3 API**
- La doc de Trading API usa `1000000 = 1 USDT (decimals=6)` como ejemplo, pero USDT en BSC (`0x55d3…7955`) tiene **18 decimales**. Comprobado onchain.
- El `requestPath` firmado tiene que incluir el prefijo `/build`. La doc misma dice que es la causa nº1 del error `40102`.
- Market, Wallet y Transaction devuelven **HTTP 200 con `code` ≠ 0** cuando fallan. Hay que revisar `code` siempre.
- El SDK `@binance-web3/wallet` (v13.0.1) exige `evmTx`, `solTx` y `tronTx` en `simulateTransactions`, aunque solo uno aplica. Usamos `fetch` directo.
- El timeout por defecto del SDK es de 1000 ms, muy corto para cotizaciones RFQ.
- Ondo y bStocks se ejecutan por **RFQ** (firma EIP-712 + `POST /order/submit`), no con una transacción normal. Esto no está claro en la sección de swaps.
- No está documentado si `toTokenAmount` viene en unidades mínimas o humanas. Pendiente verificar con una cotización real.
- No está claro si `slippagePercent=1` significa 1% o 100%. Nos defendemos comparando `minReceiveAmount`. Pendiente verificar.
- El estado de mercado devuelve `marketStatus: "offhours"`, que no está en el enum documentado (`premarket|regular|postmarket|overnight|closed|pause`).
- El listado público `type=1` (Ondo) devuelve 1366 tokens de 3 cadenas (56, 1 y Solana). Hay que filtrar `chainId === "56"`.
- `referencePrice` de la API autenticada se deriva del precio onchain, no de la bolsa real. Para la bolsa usamos `stockInfo.price` (público) y Yahoo Finance.
- No hay testnet para la Trading API: todo se prueba en mainnet con montos chicos.

**Liquidez (3 oct, sábado)**
- xStocks en BSC casi sin liquidez: NVDAx/USDC tenía ~$645 en reservas y $0 de volumen en 24 h (GeckoTerminal).
- Brecha token vs bolsa en fin de semana: NVDAon +0,23 %, NVDAB +0,17 %, TSLAB -0,14 % (medido con `npm run check`).

**BNB Agent Studio**
- Las docs mezclan el diseño viejo en Python (`signing.py`, puertos 8003/8080) con el runtime actual en TypeScript.
- `bag mcp serve` y `bag deploy package` aparecen en la documentación, pero no existen en `@bnbagent/studio-cli@0.0.14`.
- El README dice que el entrypoint es `main.ts`; las plantillas generan `unifiedMain.ts`.
- La política de firma por defecto solo permite EIP-3009. Las órdenes RFQ (Permit2, CowSwap, 1inch Fusion) necesitan `[wallet.signing].extra_domains`.
- El deploy gestionado (48 h) es solo testnet y recicla procesos inactivos tras 1 min, así que no sirve para un bot de Telegram en mainnet.
- El top-up de Pieverse corre solo en BSC mainnet, aunque el agente esté en testnet.

**Agent Studio en la práctica (3 oct, `bag init` + `bag dev` local)**
- `bag init --no-onboard` genera el workspace sin wallet: útil para commitear el scaffold sin secretos.
- `bag dev` dice que `/x402` es "PAID — active when B402 credentials are configured", pero con `price_usd = "0"` responde gratis (`bag doctor` lo informa bien como FREE).
- El scaffold trae `zod ^3.25`; para compartir código con un proyecto en zod 4 hay que importar desde `zod/v4`.
- `bag doctor` valida el bundle del deploy con esbuild (`zip bundle — esbuild dry run OK`), lo que viene bien para saber que el código externo empaqueta.
- Con el agente sin fondos, `bag doctor` avisa que hacen falta ≥ 0,02 tBNB para el registro ERC-8004.

**Vercel con runtime Bun (3 oct, primer deploy real)**
- `"engines": {"node": ">=20"}` en `package.json` pisa a `bunVersion` de `vercel.json` sin error: solo avisa y usa Node. Después falla buscando `public/`.
- Un proyecto creado con `vercel link --yes` queda con el preset "Other". Hubo que forzar `"framework": "bun"` en `vercel.json`.
- El preset de Bun elige `src/app.ts` antes que `src/server.ts`, aunque la guía de Bun dice que el punto de entrada es `server.ts` o `src/server.ts`. Lo resolvimos con un `server.ts` en la raíz.
- `@vercel/backends` falla con TypeScript 7 (`Cannot read properties of undefined (reading 'readFile')` en `ts.sys`). Bajamos a TypeScript 6.0.3.
- `vercel integration add upstash/upstash-kv` deja `autoUpgrade=true` por defecto (pasa solo a plan pago) e instala guías de Upstash para IA en `.agents/` y `.claude/skills/` del proyecto sin avisar.
- En producción, la función caía con `500 FUNCTION_INVOCATION_FAILED`. Los logs decían `Cannot find package '@noble/hashes' imported from …/@noble/hashes/esm/utils.js`: el rastreo de archivos no incluyó `esm/cryptoNode.js`, que Bun elige por la condición `node` de `exports`. El build había terminado "Ready" igual.
- El builder usa `outDir` de `tsconfig` (`dist/`) como carpeta de salida y elige `dist/app.js` como handler, aunque el log dice "Using server.ts as the root entrypoint". Lo resolvimos con un bundle único de esbuild.
