import type { MarketSession } from "../domain/market-hours.js";

export const DISCLAIMER =
  "Primera Acción ejecuta lo que tú decides: no da recomendaciones de inversión. Invierte solo lo que puedas perder.";

export const HELP = `👋 *Hola, soy Primera Acción.*
Te ayudo a comprar acciones de empresas de EE.UU. tokenizadas en BNB Chain, pagando con USDT.

*Prueba escribiendo:*
• \`precio de apple\`
• \`compra 10 de nvidia\`
• \`vende todo mi tesla\`
• \`portafolio\`
• \`armame una canasta de chips: NVDA 40 AMD 30 TSM 30\`
• \`invierte 50 en mi canasta chips\`
• \`compra 20 de mi canasta chips cada 7 días\`
• \`¿qué es una acción tokenizada?\`

*Comandos:* /precio /comprar /vender /portafolio /canastas /historial /ayuda

Antes de cada operación te muestro el precio, el slippage y una simulación, y no hago nada hasta que confirmes.

_${DISCLAIMER}_`;

export const WHAT_IS_TOKENIZED = `*¿Qué es una acción tokenizada?*
Es un token en la blockchain que sigue el precio de una acción real (por ejemplo Apple). Lo emite una empresa (bStocks, Ondo o xStocks) que respalda el token con la acción o con un instrumento equivalente.

*Lo bueno:* puedes comprar con montos chicos en USDT, a cualquier hora, sin abrir una cuenta en un broker de EE.UU. (algunos emisores piden un mínimo por orden, por ejemplo 20 USD).

*Lo que tienes que saber:*
• Dependes del emisor que respalda el token.
• Fuera del horario de la bolsa de EE.UU. el precio onchain se puede separar del último cierre.
• Si hay poca liquidez, el precio que pagas puede empeorar con montos grandes (slippage).
• Los derechos (dividendos, votos) dependen de cada emisor.`;

export function sessionLabel(session: MarketSession): string {
  switch (session) {
    case "open":
      return "🟢 Bolsa de EE.UU. abierta";
    case "closed-weekend":
      return "🌙 Bolsa cerrada (fin de semana)";
    case "closed-holiday":
      return "🌙 Bolsa cerrada (feriado en EE.UU.)";
    case "closed-overnight":
      return "🌙 Bolsa cerrada (fuera de horario)";
  }
}

export const CLOSED_MARKET_WARNING =
  "La bolsa de EE.UU. está cerrada: el token sigue operando, pero su precio puede moverse distinto al de la acción hasta la próxima apertura.";

export const usd = (n: number) =>
  `${n.toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;

export const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

export const units = (n: number) => n.toLocaleString("es-BO", { maximumFractionDigits: 6 });
