import { describe, expect, it } from "vitest";
import { IntentSchema, parseIntentRules } from "./intents.js";

describe("parseIntentRules", () => {
  it.each([
    ["compra 20 de apple", { kind: "buy", ticker: "AAPL", usd: 20 }],
    ["Quiero comprar 12,5 usdt en Nvidia", { kind: "buy", ticker: "NVDA", usd: 12.5 }],
    ["invierte 50 dólares en el s&p500", { kind: "buy", ticker: "SPY", usd: 50 }],
    ["/comprar 10 TSLA", { kind: "buy", ticker: "TSLA", usd: 10 }],
    ["precio de tesla", { kind: "price", ticker: "TSLA" }],
    ["¿cuánto vale microsoft?".replace("¿", ""), { kind: "price", ticker: "MSFT" }],
    ["vende todo mi apple", { kind: "sell", ticker: "AAPL", usd: "all" }],
    ["vender 5 de meta", { kind: "sell", ticker: "META", usd: 5 }],
    ["portafolio", { kind: "portfolio" }],
    ["analiza nvidia", { kind: "analyze", ticker: "NVDA" }],
    ["/analizar TSLA", { kind: "analyze", ticker: "TSLA" }],
    ["info de mercado libre", { kind: "analyze", ticker: "MELI" }],
    ["canasta chips NVDA 50 AMD 50", { kind: "basket_create", name: "chips", weights: { NVDA: 0.5, AMD: 0.5 } }],
    ["invierte 30 en mi canasta chips", { kind: "basket_buy", basket: "chips", usd: 30 }],
    ["compra 20 de mi canasta chips cada 7 días", { kind: "dca_create", basket: "chips", usd: 20, everyDays: 7 }],
    ["compra 10 de apple cada 30 dias", { kind: "dca_create", basket: "apple", usd: 10, everyDays: 30 }],
    ["rebalancea mi canasta chips", { kind: "basket_rebalance", basket: "chips" }],
    ["hola", { kind: "help" }],
  ])("%s", (input, expected) => {
    const intent = parseIntentRules(input);
    expect(intent).toEqual(expected);
    expect(IntentSchema.safeParse(intent).success).toBe(true);
  });

  it("devuelve null si no entiende (lo resuelve el LLM)", () => {
    expect(parseIntentRules("armame algo con empresas de chips, unos 100")).toBeNull();
  });
});
