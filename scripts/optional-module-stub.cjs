// Reemplaza dependencias opcionales (bufferutil, utf-8-validate, encoding, supports-color) en el bundle de Vercel.
// Las librerías las piden dentro de try/catch y funcionan sin ellas; si quedaran como require() externo,
// Bun intentaría instalarlas al arrancar y en Vercel el disco es de solo lectura (EROFS).
const err = new Error("Módulo opcional no incluido en el bundle");
err.code = "MODULE_NOT_FOUND";
throw err;
