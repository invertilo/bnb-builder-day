// En el bundle de Vercel, el polyfill abort-controller se reemplaza por el nativo: el fetch nativo rechaza
// señales del polyfill, y grammY reintentaba getMe para siempre ("Network request failed").
module.exports = { AbortController: globalThis.AbortController, AbortSignal: globalThis.AbortSignal, default: globalThis.AbortController };
