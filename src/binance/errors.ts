/** Error de la Binance Web3 API con un mensaje en español para mostrar al usuario. */
export class BinanceApiError extends Error {
  constructor(
    readonly code: string | number,
    readonly apiMessage: string,
    readonly path: string,
  ) {
    super(humanize(code, apiMessage));
  }
}

const MESSAGES: Record<string, string> = {
  "40101": "La API key de Binance no es válida.",
  "40102": "La firma de la API de Binance no es válida (revisa BINANCE_API_SECRET y la hora del sistema).",
  "40103": "La API key de Binance expiró o no tiene permiso para este módulo.",
  "40301": "Binance bloquea esta región.",
  "40302": "Binance detectó un proxy o VPN. Desactívalo e intenta de nuevo.",
  "40366": "El monto supera el máximo por orden que permite Ondo.",
  "40367": "Ondo no permite operar esta acción en este momento.",
  "40368": "Ondo solo opera contra USDT en BSC.",
  "40369": "bStocks no opera en este horario.",
  "40370": "bStocks no permite este par de trading.",
  "40374": "No hay suficiente liquidez para este monto. Prueba con uno menor.",
  "40375": "El monto es muy chico para Ondo (el mínimo suele ser 20 USD).",
  "40401": "La cotización venció. Vuelve a pedir la operación.",
  "42900": "Demasiadas solicitudes a Binance. Espera unos segundos.",
};

function humanize(code: string | number, apiMessage: string): string {
  const known = MESSAGES[String(code)];
  return known ? `${known} (código ${code})` : `Binance respondió ${code}: ${apiMessage}`;
}
