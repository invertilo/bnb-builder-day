# Primera Acción en Vercel (runtime Bun)

El agente corre en Vercel como una sola función con `Bun.serve()` (`src/server.ts`), siguiendo la [guía de Bun para Vercel](https://bun.com/guides/deployment/vercel): `bunVersion` en `vercel.json`, `bun.lock` y el servidor en `src/server.ts`.

| Ruta | Para qué |
|---|---|
| `GET /` | Página para probar el análisis sin Telegram (sirve como link de demo para el jurado) |
| `POST /api/analyze` · `GET /api/analyze?prompt=` | Análisis pre-compra para personas y **otros agentes** (`{"prompt":"NVDA 25"}` → `{"result": "…"}`) con CORS y rate limit |
| `POST /api/telegram` | Webhook del bot. Valida `X-Telegram-Bot-Api-Secret-Token`, procesa el mensaje y responde 200 |
| `GET /api/cron/dca` | Compras programadas (DCA), llamado por Vercel Cron con `Authorization: Bearer $CRON_SECRET` |
| `GET /api/info` · `GET /health` | Estado del agente |

## Qué cambia respecto del bot local

| Local (`npm run dev`, Docker) | Vercel |
|---|---|
| Telegram por *long polling* | Telegram por **webhook** con secreto |
| Confirmaciones pendientes en memoria | En **Upstash Redis** con vencimiento. `GETDEL` evita que un doble clic ejecute dos veces aunque caiga en otra instancia |
| Estado en `data/state.json` | Canastas, DCA e historial en Redis |
| DCA con `setInterval` | **Vercel Cron**, una vez por día (`0 14 * * *` = 10:00 en Bolivia) |

El webhook procesa el mensaje **antes** de responder. Probamos responder al instante y seguir con `waitUntil`, pero el runtime Bun de Vercel (beta) congela la función apenas responde y el bot no contestaba. Si una compra tarda tanto que Telegram reintenta, la confirmación ya se tomó de Redis (`GETDEL`) y no se ejecuta dos veces.

## Lo que hizo falta para que el preset de Bun funcione

Lo encontramos en el primer deploy real (3 oct):

- **`"framework": "bun"` en `vercel.json`.** Un proyecto creado con `vercel link` queda con el preset "Other" y busca una carpeta `public/`.
- **Sin `"engines": { "node": … }` en `package.json`.** Si existe, Vercel lo prioriza sobre `bunVersion` y usa Node.
- **`server.ts` en la raíz.** Vercel busca el punto de entrada en el orden `app`, `index`, `server`, `main` y después `src/app`, `src/index`, `src/server`, así que encontraba `src/app.ts` antes que `src/server.ts`. El `server.ts` de la raíz solo importa `src/server.ts`.
- **TypeScript 6, no 7.** El builder (`@vercel/backends`) llama a `ts.sys.readFile`, que TypeScript 7 ya no expone.
- **Un solo bundle con esbuild (`npm run build:vercel` → `dist/server.js`).** Si `dist/` tiene la salida de `tsc`, Vercel toma `dist/app.js` como handler, porque busca `app` antes que `server`. Además, el rastreo de archivos no incluía `@noble/hashes/esm/cryptoNode.js`, que Bun resuelve con la condición `node` (lo usa `viem`). Con un bundle único, en `dist/` solo queda `server.js` y no hay nada que resolver al ejecutarse.
- **Sin `require` externos en el bundle.** Sin `node_modules`, Bun intenta *auto-instalar* cualquier paquete que falte, y en Vercel el disco es de solo lectura (`bun is unable to write files: EROFS`). Las dependencias opcionales (`bufferutil`, `utf-8-validate`, `encoding`, `supports-color`) se reemplazan con `scripts/optional-module-stub.cjs`, que responde "no encontrado" y deja que el `try/catch` de cada librería siga sin ellas. Además, `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` desactiva la caché en disco del transpilador.
- **`node-fetch` y `abort-controller` → nativos en el bundle** (`scripts/shims/`). Bun los reemplaza solo cuando carga desde `node_modules`, pero no dentro de un bundle. Sin esto, el bot de Telegram (grammY) no podía llamar a la API y `bot.init()` reintentaba para siempre.

## Deploy paso a paso

1. **Proyecto en Vercel.** Importa el repo desde el dashboard (New Project → GitHub → `bnb-builder-day`) o usa la CLI:
   ```bash
   bunx vercel login
   bunx vercel link
   ```
2. **Redis.** Desde la CLI (plan gratis, sin pasar a pago al llegar al límite):
   ```bash
   bunx vercel integration add upstash/upstash-kv --plan free -m primaryRegion=iad1 -m autoUpgrade=false -m eviction=true --name primera-accion-redis --no-env-pull
   ```
   O en el dashboard: Storage → Marketplace → Upstash for Redis. Vercel agrega `KV_REST_API_URL` y `KV_REST_API_TOKEN`. Ojo: `autoUpgrade` viene en `true` por defecto.
3. **Variables de entorno** (Settings → Environment Variables, entorno Production):

   | Variable | Obligatoria | Nota |
   |---|---|---|
   | `TELEGRAM_BOT_TOKEN` | Para el bot | De @BotFather |
   | `TELEGRAM_WEBHOOK_SECRET` | Para el bot | `openssl rand -hex 32` |
   | `TELEGRAM_TRADER_IDS` | Para operar | IDs separados por coma |
   | `CRON_SECRET` | Para el DCA | `openssl rand -hex 32` |
   | `LLM_API_KEY` | Para la IA | Clave de [OpenRouter](https://openrouter.ai/keys) (`LLM_MODEL=deepseek/deepseek-v4-flash` es el valor por defecto) |
   | `BINANCE_API_KEY` / `BINANCE_API_SECRET` | Para operar | Binance Web3 dev portal |
   | `AGENT_PRIVATE_KEY` | Para operar | Wallet caliente del agente: solo montos chicos |

   Sin las variables de trading, el deploy funciona en **modo solo lectura** (página, análisis y precios).
4. **Deploy:**
   ```bash
   bunx vercel deploy --prod
   ```
5. **Conectar el bot al deploy** (desde tu máquina, con el mismo `TELEGRAM_WEBHOOK_SECRET` en tu `.env`):
   ```bash
   npm run webhook:set -- https://tu-proyecto.vercel.app
   ```
   Para volver al modo local (`npm run dev`): `npm run webhook:set -- --delete`. Un bot no puede usar webhook y polling a la vez.

## Probar local con Bun

```bash
bun install
bun run src/server.ts           # o: npm run web
curl -X POST localhost:3000/api/analyze -H 'Content-Type: application/json' -d '{"prompt":"NVDA 25"}'
```

Probado con Bun 1.4.2: página, `/health`, `/api/info` y `/api/analyze` con datos reales. El webhook responde 503 sin secreto configurado y el cron responde 401 sin autorización.

## Límites y avisos

- **Cron en plan Hobby:** una vez por día y con horario aproximado dentro de la hora. Como el DCA se mide en días, alcanza.
- **`/api/analyze` es público y usa el LLM:** por defecto acepta 10 consultas por minuto por IP y 500 por día en total (`ANALYZE_RATE_LIMIT_PER_MIN`, `ANALYZE_DAILY_LIMIT`).
- **La clave de la wallet queda en Vercel** (cifrada, pero es una wallet caliente en la nube). Úsenla solo con montos chicos.
- El runtime Bun de Vercel está en **beta**.
- `bun.lock` y `package-lock.json` conviven: Vercel instala con Bun, mientras CI y Docker usan npm. Si cambian dependencias, actualicen los dos (`npm install` y `bun install`).
