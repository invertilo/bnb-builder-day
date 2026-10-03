import { InlineKeyboard } from "grammy";

/** Lo que el bot sabe de su propia configuración (sin secretos). */
export interface BotStatus {
  /** Modelo de IA activo, o null si no hay LLM_API_KEY. */
  ai: string | null;
  /** BINANCE_API_KEY y BINANCE_API_SECRET cargadas. */
  binance: boolean;
  /** Dirección de la wallet del agente, o null. */
  wallet: string | null;
  limits: { maxTradeUsd: number; maxDailyUsd: number; maxSlippageBps: number };
  webUrl: string;
}

export interface Screen {
  text: string;
  keyboard: InlineKeyboard;
}

/** Botones "probar" del onboarding → mensaje que se manda al agente. */
export const TRY_PROMPTS: Record<string, string> = {
  precio: "precio de apple",
  analisis: "analiza nvidia",
  canastas: "canastas",
  tokenizada: "¿qué es una acción tokenizada?",
  ayuda: "ayuda",
};

const ok = (b: boolean) => (b ? "✅" : "⬜️");
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function welcome(firstName: string | undefined, canTrade: boolean, status: BotStatus): Screen {
  const name = firstName ? `, ${firstName.replace(/[*_`[\]]/g, "")}` : "";
  const text = [
    `👋 *¡Hola${name}! Soy Primera Acción.*`,
    "Te ayudo a invertir en acciones de EE.UU. (Apple, NVIDIA, Tesla…) tokenizadas en BNB Chain, pagando con USDT.",
    "",
    "*Empecemos en 3 pasos:*",
    "*1.* Mira un precio real de la bolsa → *Ver un precio*",
    "*2.* Pide un análisis con IA → *Analizar una acción*",
    `*3.* ${canTrade ? "Revisa que todo esté listo para operar" : "Configura el bot para poder operar"} → *Configurar*`,
    "",
    "También puedes escribirme normal:",
    "• `precio de tesla`",
    "• `analiza microsoft`",
    "• `compra 25 de apple`",
    "",
    "Antes de cada operación te muestro el precio y te pido confirmación. No doy recomendaciones de inversión.",
  ].join("\n");
  const keyboard = new InlineKeyboard()
    .text("📈 Ver un precio", "go:precio")
    .text("🧠 Analizar una acción", "go:analisis")
    .row()
    .text("🧺 Canastas", "go:canastas")
    .text("❓ ¿Qué es esto?", "go:tokenizada")
    .row()
    .text("⚙️ Configurar", "cfg:status")
    .url("🌐 Abrir la web", status.webUrl);
  return { text, keyboard };
}

/** Checklist de configuración con el siguiente paso pendiente. */
export function configStatus(userId: number, canTrade: boolean, status: BotStatus): Screen {
  const tradingReady = status.binance && Boolean(status.wallet);
  const steps: Array<[boolean, string, string]> = [
    [canTrade, `Tu autorización para operar (ID \`${userId}\`)`, "cfg:autorizar"],
    [status.binance, "API de Binance Web3", "cfg:binance"],
    [Boolean(status.wallet), status.wallet ? `Wallet del agente \`${short(status.wallet)}\`` : "Wallet del agente", "cfg:wallet"],
  ];
  const next = steps.find(([done]) => !done);
  const text = [
    "⚙️ *Configuración de tu agente*",
    "",
    "✅ Bot de Telegram conectado",
    `${ok(Boolean(status.ai))} IA${status.ai ? `: \`${status.ai}\`` : " (sin LLM: el agente analiza con sus propias reglas)"}`,
    ...steps.map(([done, label]) => `${ok(done)} ${label}`),
    "",
    tradingReady && canTrade
      ? "🟢 *Listo para operar.* Prueba: `compra 25 de apple`."
      : "🔵 *Modo consulta:* ya puedes ver precios, análisis y canastas. Para comprar y vender completa los pasos que faltan.",
    next ? `\n*Siguiente paso:* toca *${stepLabel(next[2])}*.` : "",
  ].join("\n");

  const keyboard = new InlineKeyboard();
  steps.forEach(([done, , data], i) => {
    keyboard.text(`${done ? "✅" : `${i + 1}.`} ${stepLabel(data)}`, data).row();
  });
  keyboard.text("🛡️ Límites de seguridad", "cfg:limites").row().text("🔄 Revisar de nuevo", "cfg:status").text("⬅️ Inicio", "cfg:inicio");
  return { text, keyboard };
}

function stepLabel(data: string): string {
  return { "cfg:autorizar": "Autorizarme", "cfg:binance": "Conectar Binance", "cfg:wallet": "Crear la wallet" }[data] ?? "Configurar";
}

const SECURITY_NOTE = "🔐 Nunca pegues claves ni tokens en este chat: se cargan solo en tu computadora y en Vercel.";
const back = () => new InlineKeyboard().text("⬅️ Volver a la configuración", "cfg:status");

export function configStep(step: string, userId: number, canTrade: boolean, status: BotStatus): Screen | null {
  switch (step) {
    case "autorizar":
      return {
        text: [
          "👤 *Paso 1 · Autorizarte para operar*",
          "",
          `Tu ID de Telegram es \`${userId}\`.`,
          canTrade ? "✅ Ya estás autorizado." : "",
          "",
          "En tu computadora, dentro del proyecto:",
          `*1.* Abre el archivo \`.env\` y agrega: \`TELEGRAM_TRADER_IDS=${userId}\``,
          "*2.* Corre: `npm run telegram:setup`",
          "*3.* Vuelve acá y toca *Revisar de nuevo*.",
          "",
          "Solo los IDs autorizados pueden comprar, vender o ver el portafolio. El resto solo consulta.",
        ].join("\n"),
        keyboard: back(),
      };
    case "binance":
      return {
        text: [
          "🔑 *Paso 2 · Conectar la API de Binance Web3*",
          "",
          "*1.* Entra a web3.binance.com/en/dev-portal con tu cuenta de Binance.",
          "*2.* Crea un proyecto con permisos *Trading, Market, Wallet y Transaction*.",
          "*3.* En tu `.env` agrega `BINANCE_API_KEY=…` y `BINANCE_API_SECRET=…`",
          "*4.* Corre: `npm run telegram:setup` (sube las claves a Vercel y redespliega).",
          "",
          status.binance ? "✅ Ya está conectada." : "⬜️ Todavía no está conectada.",
          "",
          SECURITY_NOTE,
        ].join("\n"),
        keyboard: back(),
      };
    case "wallet":
      return {
        text: [
          "👛 *Paso 3 · Wallet del agente*",
          "",
          status.wallet ? `✅ Wallet activa: \`${status.wallet}\`` : "*1.* En tu computadora corre: `npm run wallet:new` (crea la wallet y la guarda en `.env`).",
          status.wallet ? "" : "*2.* Corre: `npm run telegram:setup` para subirla a Vercel.",
          "",
          "*Fondéala en BNB Smart Chain (BEP-20):*",
          "• un poco de *BNB* para gas (≈ 0,005 BNB)",
          "• *USDT* para comprar (Ondo pide ≈ 20 USD por orden)",
          "",
          "⚠️ Es una wallet caliente: úsala solo con montos chicos.",
          SECURITY_NOTE,
        ].join("\n"),
        keyboard: back(),
      };
    case "limites":
      return {
        text: [
          "🛡️ *Límites de seguridad*",
          "",
          `• Máximo por operación: *${status.limits.maxTradeUsd} USDT*`,
          `• Máximo por día: *${status.limits.maxDailyUsd} USDT*`,
          `• Slippage máximo: *${(status.limits.maxSlippageBps / 100).toFixed(2)}%*`,
          "",
          "Además: cada orden se simula antes de enviarse, te muestra la brecha con la bolsa y no se ejecuta sin tu *Confirmar*.",
          "",
          "Para cambiarlos: edita `MAX_TRADE_USD`, `MAX_DAILY_USD` o `MAX_SLIPPAGE_BPS` en `.env` y corre `npm run telegram:setup`.",
        ].join("\n"),
        keyboard: back(),
      };
    default:
      return null;
  }
}
