// En el bundle de Vercel, node-fetch se reemplaza por el fetch nativo (es lo que hace Bun al cargar desde node_modules).
// node-fetch usa node:https, que en el runtime Bun de Vercel deja las llamadas colgadas.
const nativeFetch = (...args) => globalThis.fetch(...args);
module.exports = nativeFetch;
module.exports.default = nativeFetch;
module.exports.Headers = globalThis.Headers;
module.exports.Request = globalThis.Request;
module.exports.Response = globalThis.Response;
