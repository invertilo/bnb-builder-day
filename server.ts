// Entrada para Vercel (preset de Bun). Vercel busca server.ts en la raíz antes que src/app.ts,
// así que este archivo solo carga el servidor real (src/server.ts), que llama a Bun.serve().
import "./src/server.js";
